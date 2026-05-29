// Public API — connect(opts) → page object, snapshot(opts) one-shot

import {
  listDevices, exec, shell, dumpXml, screenSize,
  shellQuote, validatePackage, validateIntentAction, validateExtraKey,
} from './adb.js';
import { DeviceError, WaitTimeout, SelectorNotFound, InvalidArgument } from './errors.js';
import * as apps from './apps.js';
import { isTermux, resolveTermuxDevice } from './termux.js';
import { parseXml } from './xml.js';
import { prune } from './prune.js';
import { formatTree } from './aria.js';
import * as interact from './interact.js';
import { loadSavedDevice, reconnectWifi } from './wifi-persist.js';

/**
 * One-shot snapshot: dump + parse + prune + format.
 * @param {{serial?: string}} [opts]
 * @returns {Promise<string>} YAML snapshot
 */
export async function snapshot(opts = {}) {
  const xml = await dumpXml(opts);
  const root = parseXml(xml);
  if (!root) throw new DeviceError('Failed to parse XML tree');
  const { tree } = prune(root);
  if (!tree) throw new DeviceError('Entire tree pruned away');
  return formatTree(tree);
}

/**
 * Connect to a device and return a page object.
 * @param {{device?: string, termux?: boolean}} [opts] - device serial or 'auto' (default)
 * @returns {Promise<object>} page
 */
export async function connect(opts = {}) {
  // Resolve device serial
  let serial = opts.device;
  if (!serial || serial === 'auto') {
    // Termux mode: explicit opt-in or auto-detect
    if (opts.termux || (!opts.device && await isTermux())) {
      serial = await resolveTermuxDevice();
    } else {
      let devices = await listDevices();
      if (devices.length === 0) {
        // Try auto-reconnect from saved WiFi device
        const saved = loadSavedDevice();
        if (saved) {
          await reconnectWifi(saved);
          devices = await listDevices();
        }
        if (devices.length === 0) throw new DeviceError('No ADB devices found. Is a device/emulator connected?');
      }
      serial = devices[0].serial;
    }
  }

  const adbOpts = { serial };
  let _refMap = new Map();

  // Resolve a refOrSelector to a numeric ref. A ref is a string or number
  // that maps to the current snapshot's _refMap. A selector is a plain
  // object like {text: "Settings"} or {contentDesc: "Search"} — we
  // re-snapshot (so the match is against fresh UI) and substring-match.
  // Throws SelectorNotFound if the selector matches nothing.
  async function resolveSelector(refOrSelector) {
    if (typeof refOrSelector === 'string' || typeof refOrSelector === 'number') {
      return refOrSelector;
    }
    if (!refOrSelector || typeof refOrSelector !== 'object') {
      throw new InvalidArgument(`Selector must be a ref (string/number) or object {text|contentDesc}; got ${typeof refOrSelector}`);
    }
    if (!('text' in refOrSelector) && !('contentDesc' in refOrSelector)) {
      throw new InvalidArgument(`Selector object must have at least one of: text, contentDesc`);
    }
    // Refresh the snapshot so the match is against current UI.
    await page.snapshot();
    for (const [ref, node] of _refMap) {
      if (refOrSelector.text != null && node.text?.includes(refOrSelector.text)) return ref;
      if (refOrSelector.contentDesc != null && node.contentDesc?.includes(refOrSelector.contentDesc)) return ref;
    }
    throw new SelectorNotFound(refOrSelector);
  }

  const page = {
    serial,
    platform: 'android',

    /**
     * Snapshot the UI.
     * @param {{maxDepth?: number, maxNodes?: number}} [snapOpts]
     */
    async snapshot(snapOpts = {}) {
      const xml = await dumpXml(adbOpts);
      const root = parseXml(xml);
      if (!root) throw new DeviceError('Failed to parse XML tree');
      const { tree, refMap } = prune(root, snapOpts);
      if (!tree) throw new DeviceError('Entire tree pruned away');
      _refMap = refMap;
      return formatTree(tree);
    },

    async tap(refOrSelector) {
      const ref = await resolveSelector(refOrSelector);
      await interact.tap(ref, _refMap, adbOpts);
    },

    async type(refOrSelector, text, opts = {}) {
      const ref = await resolveSelector(refOrSelector);
      await interact.type(ref, text, _refMap, { ...adbOpts, ...opts });
    },

    async press(key) {
      await interact.press(key, adbOpts);
    },

    async swipe(x1, y1, x2, y2, duration) {
      await interact.swipe(x1, y1, x2, y2, duration, adbOpts);
    },

    async scroll(refOrSelector, direction) {
      const ref = await resolveSelector(refOrSelector);
      await interact.scroll(ref, direction, _refMap, adbOpts);
    },

    async longPress(refOrSelector) {
      const ref = await resolveSelector(refOrSelector);
      await interact.longPress(ref, _refMap, adbOpts);
    },

    async tapXY(x, y) {
      await interact.tapXY(x, y, adbOpts);
    },

    async tapGrid(cell) {
      const size = await screenSize(adbOpts);
      await interact.tapGrid(cell, size.width, size.height, adbOpts);
    },

    async grid() {
      const size = await screenSize(adbOpts);
      return interact.buildGrid(size.width, size.height);
    },

    async back() {
      await interact.press('back', adbOpts);
    },

    async home() {
      await interact.press('home', adbOpts);
    },

    async launch(pkg) {
      validatePackage(pkg);
      const out = await shell(`am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${pkg} 2>&1`, adbOpts);
      // Fallback: if MAIN/LAUNCHER intent fails, try monkey launch (works for Termux etc.)
      if (/Error|does not have|Activity not found/i.test(out)) {
        await shell(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1 2>/dev/null`, adbOpts);
      }
    },

    async intent(action, extras = {}) {
      validateIntentAction(action);
      let cmd = `am start -a ${action}`;
      for (const [k, v] of Object.entries(extras)) {
        validateExtraKey(k);
        if (typeof v === 'number' && Number.isFinite(v)) cmd += ` --ei ${k} ${v}`;
        else if (typeof v === 'boolean') cmd += ` --ez ${k} ${v}`;
        else cmd += ` --es ${k} ${shellQuote(v)}`;
      }
      await shell(cmd, adbOpts);
    },

    async waitForText(text, timeout = 10_000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const snap = await page.snapshot();
        if (snap.includes(text)) return snap;
        await new Promise(r => setTimeout(r, 500));
      }
      throw new WaitTimeout(`text "${text}"`, timeout);
    },

    /**
     * Resolve once two consecutive snapshots taken `stableMs` apart match
     * (string equality after formatTree). Useful for waiting out
     * animations / list refreshes before acting. Throws WaitTimeout if
     * the UI never stabilises within `timeout`.
     */
    async waitForStable({ pollMs = 250, stableMs = 500, timeout = 5000 } = {}) {
      const start = Date.now();
      let prev = await page.snapshot();
      let prevAt = Date.now();
      while (Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, pollMs));
        const next = await page.snapshot();
        if (next === prev && (Date.now() - prevAt) >= stableMs) return next;
        if (next !== prev) { prev = next; prevAt = Date.now(); }
      }
      throw new WaitTimeout(`UI to stabilise (pollMs=${pollMs}, stableMs=${stableMs})`, timeout);
    },

    async waitForState(ref, state, timeout = 10_000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const snap = await page.snapshot();
        const node = _refMap.get(ref);
        if (node) {
          const has = state === 'enabled' ? node.enabled
            : state === 'disabled' ? !node.enabled
            : state === 'checked' ? node.checked
            : state === 'unchecked' ? !node.checked
            : state === 'focused' ? node.focused
            : state === 'selected' ? node.selected
            : null;
          if (has) return snap;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      throw new WaitTimeout(`ref ${ref} state "${state}"`, timeout);
    },

    async screenshot() {
      return exec(['exec-out', 'screencap -p'], { serial, timeout: 10_000, encoding: 'buffer' });
    },

    findByText(text) {
      for (const [ref, node] of _refMap) {
        if (node.text?.includes(text) || node.contentDesc?.includes(text)) return ref;
      }
      return null;
    },

    // App helpers — Android only (pm grant/revoke/clear under the hood).
    async grantPermission(pkg, perm) { return apps.grantPermission(pkg, perm, adbOpts); },
    async revokePermission(pkg, perm) { return apps.revokePermission(pkg, perm, adbOpts); },
    async clearAppData(pkg) { return apps.clearAppData(pkg, adbOpts); },
    async listPermissions(pkg) { return apps.listPermissions(pkg, adbOpts); },

    close() {
      // ADB is stateless — no per-page teardown needed. The daemon owns its
      // own lifecycle (HTTP server + child process), so close() here is a
      // shape-matching no-op against the iOS page's WDA-tunnel close().
    },
  };

  return page;
}
