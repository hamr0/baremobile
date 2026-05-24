// iOS device control via WebDriverAgent (WDA).
// Same page-object API as Android — snapshot, tap, type, swipe, scroll, etc.
//
// Connection modes (auto-detected):
//   1. WiFi direct — http://<device-ip>:8100 (fastest, cable-free)
//   2. USB via usbmux — Node.js proxy to /var/run/usbmuxd (no pymobiledevice3)
//   3. Manual — connect({host: 'x.x.x.x'}) or pre-forwarded localhost:8100
//
// Translation layer: WDA XML → Android node shape → shared prune pipeline.
// Same architecture as Android: translateWda() replaces parseXml(),
// then prune() + formatTree() produce identical YAML output.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prune } from './prune.js';
import { formatTree } from './aria.js';
import { listDevices, forward } from './usbmux.js';
import { isValidIpv4 } from './wifi-persist.js';
import {
  ElementNotFound, SelectorNotFound, InvalidArgument, WdaTimeout, WdaUnavailable,
  WaitTimeout, DeviceError,
} from './errors.js';
import { traceCall } from './debug.js';

// Per-user cache, not shared /tmp: a predictable world-writable /tmp path
// lets another local user pre-create/symlink it or plant an IP that we would
// then use verbatim as the WDA host. Mirrors wifi-persist.js's location.
const WIFI_CACHE = path.join(os.homedir(), '.config', 'baremobile', 'ios-wifi');

// --- WDA HTTP helpers (instance-scoped via closure) ---

// Default per-request timeout for WDA HTTP calls. When WDA hangs (common
// after iOS lock or app crash) an unbounded fetch parks the whole MCP call.
// Surface as AbortError after this window so the retry tier in mcp-server.js
// can react. Override via BAREMOBILE_WDA_TIMEOUT_MS for slow CI machines.
const WDA_DEFAULT_TIMEOUT_MS = Number(process.env.BAREMOBILE_WDA_TIMEOUT_MS) || 10_000;

function createWda(baseUrl) {
  async function wdaFetch(path, init = {}) {
    const url = `${baseUrl}${path}`;
    const method = init.method || 'GET';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Per-attempt timeout — total wait is bounded by 3 × timeout + 2 ×
        // 500ms backoff. Callers may override via init.signal (e.g. tests).
        const signal = init.signal ?? AbortSignal.timeout(WDA_DEFAULT_TIMEOUT_MS);
        const res = await traceCall('wda', `${method} ${path}`,
          () => fetch(url, { ...init, signal }));
        return res.json();
      } catch (e) {
        const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        if (attempt === 2) {
          if (isTimeout) throw new WdaTimeout(path, WDA_DEFAULT_TIMEOUT_MS, { cause: e });
          throw e;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  const wdaGet = (path) => wdaFetch(path);
  const wdaPost = (path, body = {}) => wdaFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return { wdaGet, wdaPost };
}

/**
 * Try WDA /status at a URL. Returns true if ready.
 */
async function wdaReady(baseUrl, timeoutMs = 2000) {
  try {
    const res = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(timeoutMs) });
    const s = await res.json();
    return !!s.value?.ready;
  } catch { return false; }
}

/**
 * Resolve WDA base URL. Priority: explicit host > WiFi (cached) > USB > localhost.
 * Returns { baseUrl, cleanup } where cleanup closes any forwarder.
 */
async function resolveWda(opts) {
  // 1. Explicit host
  if (opts.host) {
    const port = opts.port || 8100;
    return { baseUrl: `http://${opts.host}:${port}`, cleanup: () => {} };
  }

  // 2. Try cached WiFi IP — works even without USB
  try {
    const cachedIp = (await fs.readFile(WIFI_CACHE, 'utf8')).trim();
    if (isValidIpv4(cachedIp)) {
      const wifiBase = `http://${cachedIp}:8100`;
      if (await wdaReady(wifiBase)) return { baseUrl: wifiBase, cleanup: () => {} };
    }
  } catch { /* no cache or stale */ }

  // 3. USB discovery — find device, get WiFi IP, cache it
  try {
    const devices = await listDevices();
    if (devices.length > 0) {
      const dev = devices[0];
      const server = await forward(dev.deviceId, 8100, 0);
      const localPort = server.address().port;
      // forward() binds 127.0.0.1; connect to the same literal (not "localhost")
      // so we never depend on how localhost resolves (IPv4 vs IPv6 first).
      const tmpBase = `http://127.0.0.1:${localPort}`;

      try {
        const res = await fetch(`${tmpBase}/status`, { signal: AbortSignal.timeout(3000) });
        const status = await res.json();
        const wifiIp = status.value?.ios?.ip;

        if (isValidIpv4(wifiIp)) {
          const wifiBase = `http://${wifiIp}:8100`;
          if (await wdaReady(wifiBase)) {
            server.close();
            await fs.mkdir(path.dirname(WIFI_CACHE), { recursive: true }).catch(() => {});
            await fs.writeFile(WIFI_CACHE, wifiIp).catch(() => {});
            return { baseUrl: wifiBase, cleanup: () => {} };
          }
        }

        // WiFi not reachable — keep USB forwarder
        return { baseUrl: tmpBase, cleanup: () => server.close() };
      } catch {
        server.close();
      }
    }
  } catch { /* usbmuxd not available */ }

  // 4. Fallback: assume pre-forwarded localhost:8100
  return { baseUrl: `http://localhost:${opts.port || 8100}`, cleanup: () => {} };
}

// --- WDA XML → Android node shape ---

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const ENTITY_RE = /&(?:amp|lt|gt|quot|apos);/g;
const UNICODE_NOISE = /[\u200B-\u200F\u2028-\u202F\u2060-\u2069\uFEFF]/g;
const IOS_PATH_RE = /\/(?:private\/)?var\/mobile\/[\w/.-]+/g;

function cleanText(s) {
  if (!s) return s;
  return s.replace(ENTITY_RE, m => ENTITIES[m]).replace(UNICODE_NOISE, '').replace(IOS_PATH_RE, '');
}

const CLICKABLE_TYPES = new Set([
  'XCUIElementTypeButton', 'XCUIElementTypeCell', 'XCUIElementTypeLink',
  'XCUIElementTypeTab', 'XCUIElementTypeKey', 'XCUIElementTypeIcon',
]);

const EDITABLE_TYPES = new Set([
  'XCUIElementTypeTextField', 'XCUIElementTypeSecureTextField',
  'XCUIElementTypeSearchField', 'XCUIElementTypeTextView',
]);

const SCROLLABLE_TYPES = new Set([
  'XCUIElementTypeScrollView', 'XCUIElementTypeTable',
  'XCUIElementTypeCollectionView',
]);

/**
 * Translate WDA /source XML into Android-shaped node tree.
 * Output is identical to parseXml() from xml.js — same fields, same shape.
 * Feeds directly into prune() + formatTree() for shared pipeline.
 *
 * @param {string} xml — WDA /source XML string
 * @returns {object | null} root node (same shape as parseXml output)
 */
export function translateWda(xml) {
  if (!xml || typeof xml !== 'string') return null;

  const nodes = [];
  const stack = [];
  // Match opening tags (self-closing or not) and closing tags
  const tagRe = /<(XCUIElementType\w+)\s([^>]*?)\/?>|<\/(XCUIElementType\w+)>/g;
  let match;

  while ((match = tagRe.exec(xml)) !== null) {
    // Closing tag
    if (match[3]) {
      stack.pop();
      continue;
    }

    const type = match[1];
    const attrStr = match[2];

    // Parse attributes
    const attrs = {};
    const attrRe = /(\w[\w-]*)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(attrStr)) !== null) {
      attrs[am[1]] = am[2];
    }

    // Skip StatusBar and Keyboard entirely — noise for agents
    if (type === 'XCUIElementTypeStatusBar' || type === 'XCUIElementTypeKeyboard') {
      if (!match[0].endsWith('/>')) {
        let depth = 1;
        while (depth > 0 && (match = tagRe.exec(xml)) !== null) {
          if (match[3]) depth--;
          else if (!match[0].endsWith('/>')) depth++;
        }
      }
      continue;
    }

    // Skip invisible leaf nodes (self-closing).
    // Invisible containers still need their children processed —
    // iOS marks CollectionView/Table as visible="false" while children are visible.
    const invisible = attrs.visible === 'false';
    if (invisible && match[0].endsWith('/>')) {
      continue; // self-closing invisible — safe to skip entirely
    }

    // Build bounds from x, y, width, height
    const x = parseInt(attrs.x, 10) || 0;
    const y = parseInt(attrs.y, 10) || 0;
    const w = parseInt(attrs.width, 10) || 0;
    const h = parseInt(attrs.height, 10) || 0;
    const bounds = (w > 0 && h > 0) ? { x1: x, y1: y, x2: x + w, y2: y + h } : null;

    // Map WDA attributes to Android node shape
    const label = cleanText(attrs.label || '');
    const name = cleanText(attrs.name || '');
    const value = cleanText(attrs.value || '');
    const isAccessible = attrs.accessible === 'true';

    const isSwitch = type === 'XCUIElementTypeSwitch' || type === 'XCUIElementTypeToggle';

    // Invisible containers: create node for nesting but strip interactive/text
    // so prune() collapses them as empty wrappers
    const node = {
      class: type,
      text: invisible ? '' : (label || ''),
      contentDesc: invisible ? '' : ((!label && name) ? name : ''),
      bounds: invisible ? null : bounds,
      clickable: invisible ? false : (CLICKABLE_TYPES.has(type) || !!(isAccessible && bounds && (label || name))),
      scrollable: invisible ? false : SCROLLABLE_TYPES.has(type),
      editable: invisible ? false : EDITABLE_TYPES.has(type),
      enabled: attrs.enabled !== 'false',
      checked: invisible ? false : (isSwitch ? value === '1' : false),
      selected: invisible ? false : (attrs.selected === 'true'),
      focused: invisible ? false : (attrs.focused === 'true'),
      children: [],
    };

    // Switches/toggles are clickable too
    if (!invisible && isSwitch) node.clickable = true;

    // Attach to parent
    if (stack.length > 0) {
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
    }

    nodes.push(node);

    // Self-closing tags don't push to stack
    if (!match[0].endsWith('/>')) {
      stack.push(node);
    }
  }

  return nodes.length > 0 ? nodes[0] : null;
}

// --- Coordinate helpers ---

function boundsCenter(bounds) {
  if (!bounds) throw new InvalidArgument('Node has no bounds');
  return {
    x: Math.round((bounds.x1 + bounds.x2) / 2),
    y: Math.round((bounds.y1 + bounds.y2) / 2),
  };
}

// --- Navigation helpers ---

/**
 * Find the back button: first Button child of a NavigationBar.
 * iOS back buttons show the previous screen name, not "Back",
 * so we locate by structure rather than text.
 */
function findNavBack(root) {
  if (!root) return null;
  function walk(node) {
    if (node.class === 'XCUIElementTypeNavigationBar') {
      // First button in navbar with bounds is the back button
      for (const child of node.children) {
        if (child.class === 'XCUIElementTypeButton' && child.bounds) return child;
      }
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }
  return walk(root);
}

// --- Public API ---

/**
 * Connect to an iOS device via WDA and return a page object.
 * Auto-discovers device: WiFi direct > USB (usbmux) > localhost:8100.
 *
 * @param {{host?: string, port?: number, passcode?: string}} [opts]
 * @returns {Promise<object>} page
 */
export async function connect(opts = {}) {
  const passcode = opts.passcode || null;
  const { baseUrl, cleanup } = await resolveWda(opts);

  // Health check — fail fast with actionable message
  if (!await wdaReady(baseUrl, 3000)) {
    cleanup();
    throw new WdaUnavailable(baseUrl, {
      cause: new Error('Ensure iPhone is connected via USB and WDA is running (npx baremobile setup).'),
    });
  }

  const { wdaGet, wdaPost } = createWda(baseUrl);

  // Anything that throws between here and the `return page` at the end of
  // connect() must release the usbmuxd tunnel held by `cleanup()`, otherwise
  // it leaks for the lifetime of the process. Wrap the whole bring-up in
  // try/catch and cleanup-and-rethrow.
  let sid;
  let _refMap = new Map();
  let _navBackNode = null;
  let _screenW = 390; // safe default
  let _screenH = 800; // safe default
  let _scaleFactor = 3; // safe default for modern iPhones

  try {
    const sessResult = await wdaPost('/session', { capabilities: {} });
    sid = sessResult.sessionId;
    if (!sid) throw new WdaUnavailable(baseUrl, { cause: new Error('WDA /session returned no sessionId') });

    // Cache screen dimensions and compute Retina scale factor. Failure here
    // is non-fatal — fall back to safe defaults — but we still need cleanup
    // on a connection-level error that escapes the inner try.
    try {
      const sz = await wdaGet(`/session/${sid}/window/size`);
      if (sz.value?.width) _screenW = sz.value.width;
      if (sz.value?.height) _screenH = sz.value.height;
      const ssResult = await wdaGet('/screenshot');
      const screenshotBuf = Buffer.from(ssResult.value, 'base64');
      // PNG header: width at bytes 16-19 (big-endian)
      const pngWidth = screenshotBuf.readUInt32BE(16);
      _scaleFactor = pngWidth / _screenW;
    } catch { /* use defaults */ }
  } catch (e) {
    cleanup();
    throw e;
  }

  // W3C Actions tap — synthesizes raw touch event, works where /wda/tap silently fails
  async function wdaTap(x, y) {
    await wdaPost(`/session/${sid}/actions`, {
      actions: [{
        type: 'pointer', id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 50 },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
  }

  // Selector resolution — see comment in src/index.js for the shape.
  // `page` is forward-declared via `let` below so this closure can call
  // page.snapshot() at invocation time (not declaration time).
  let page;
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
    await page.snapshot();
    for (const [ref, node] of _refMap) {
      if (refOrSelector.text != null && node.text?.includes(refOrSelector.text)) return ref;
      if (refOrSelector.contentDesc != null && node.contentDesc?.includes(refOrSelector.contentDesc)) return ref;
    }
    throw new SelectorNotFound(refOrSelector);
  }

  page = {
    serial: 'ios',
    platform: 'ios',
    baseUrl,
    get scaleFactor() { return _scaleFactor; },
    screenshotToPoint(px, py) {
      return { x: Math.round(px / _scaleFactor), y: Math.round(py / _scaleFactor) };
    },

    /**
     * Snapshot the UI.
     * @param {{maxDepth?: number, maxNodes?: number}} [snapOpts]
     */
    async snapshot(snapOpts = {}) {
      const r = await wdaGet('/source');
      const root = translateWda(r.value);
      _navBackNode = findNavBack(root);
      const { tree, refMap } = prune(root, snapOpts);
      _refMap = refMap;
      if (!tree) return '';
      return formatTree(tree);
    },

    async tap(refOrSelector) {
      const ref = await resolveSelector(refOrSelector);
      const key = typeof ref === 'string' ? Number(ref) : ref;
      const node = _refMap.get(key);
      if (!node) throw new ElementNotFound(ref);
      const { x, y } = boundsCenter(node.bounds);
      await wdaTap(x, y);
    },

    async type(refOrSelector, text, typeOpts = {}) {
      const ref = await resolveSelector(refOrSelector);
      const key = typeof ref === 'string' ? Number(ref) : ref;
      const node = _refMap.get(key);
      if (!node) throw new ElementNotFound(ref);

      // Coordinate tap to focus
      const { x, y } = boundsCenter(node.bounds);
      await wdaTap(x, y);
      await new Promise(r => setTimeout(r, 300));

      // Clear if requested — find focused element and use WDA clear
      if (typeOpts.clear) {
        const focused = await wdaPost(`/session/${sid}/element`, {
          using: 'predicate string',
          value: 'focused == true',
        });
        const eid = focused.value?.ELEMENT;
        if (eid) {
          await wdaPost(`/session/${sid}/element/${eid}/clear`);
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // Type text via WDA keys endpoint
      await wdaPost(`/session/${sid}/wda/keys`, { value: [...text] });
    },

    async press(key) {
      const actions = {
        home: () => wdaPost('/wda/homescreen'),
        enter: () => wdaPost(`/session/${sid}/wda/keys`, { value: ['\n'] }),
        volumeup: () => wdaPost('/wda/pressButton', { name: 'volumeUp' }),
        volumedown: () => wdaPost('/wda/pressButton', { name: 'volumeDown' }),
        volume_up: () => wdaPost('/wda/pressButton', { name: 'volumeUp' }),
        volume_down: () => wdaPost('/wda/pressButton', { name: 'volumeDown' }),
      };
      if (actions[key]) return actions[key]();
      throw new InvalidArgument(`press("${key}"): not supported on iOS. Use tap(ref) instead.`);
    },

    async swipe(x1, y1, x2, y2, duration = 300) {
      await wdaPost(`/session/${sid}/wda/dragfromtoforduration`, {
        fromX: x1, fromY: y1,
        toX: x2, toY: y2,
        duration: duration / 1000,
      });
    },

    async scroll(refOrSelector, direction) {
      const ref = await resolveSelector(refOrSelector);
      const key = typeof ref === 'string' ? Number(ref) : ref;
      const node = _refMap.get(key);
      if (!node) throw new ElementNotFound(ref);
      const { x, y } = boundsCenter(node.bounds);
      const b = node.bounds;
      const h = (b.y2 - b.y1) / 3;
      const w = (b.x2 - b.x1) / 3;

      const offsets = {
        up: { x1: x, y1: y - h, x2: x, y2: y + h },
        down: { x1: x, y1: y + h, x2: x, y2: y - h },
        left: { x1: x - w, y1: y, x2: x + w, y2: y },
        right: { x1: x + w, y1: y, x2: x - w, y2: y },
      };
      const o = offsets[direction];
      if (!o) throw new InvalidArgument(`scroll: unknown direction "${direction}"`);

      await wdaPost(`/session/${sid}/wda/dragfromtoforduration`, {
        fromX: o.x1, fromY: o.y1,
        toX: o.x2, toY: o.y2,
        duration: 0.3,
      });
    },

    async longPress(refOrSelector) {
      const ref = await resolveSelector(refOrSelector);
      const key = typeof ref === 'string' ? Number(ref) : ref;
      const node = _refMap.get(key);
      if (!node) throw new ElementNotFound(ref);
      const { x, y } = boundsCenter(node.bounds);
      await wdaPost(`/session/${sid}/wda/touchAndHold`, { x, y, duration: 1.0 });
    },

    async tapXY(x, y) {
      await wdaTap(x, y);
    },

    async back() {
      // iOS back: find the first Button inside a NavigationBar in the raw tree.
      // iOS back buttons show the previous screen name, not "Back",
      // so we can't match by text. The first navbar button is always the back button.
      if (_navBackNode) {
        const { x, y } = boundsCenter(_navBackNode.bounds);
        await wdaTap(x, y);
        return;
      }
      // Fallback: swipe from left edge (standard iOS back gesture).
      // _screenH was cached at connect() time — orientation may have changed
      // since (portrait → landscape rotates the centre line). Re-query so the
      // swipe stays mid-screen regardless of current orientation.
      let midY = _screenH / 2;
      try {
        const sz = await wdaGet(`/session/${sid}/window/size`);
        if (sz.value?.height) {
          _screenH = sz.value.height;
          if (sz.value.width) _screenW = sz.value.width;
          midY = _screenH / 2;
        }
      } catch { /* keep cached value */ }
      await page.swipe(5, midY, 300, midY, 300);
    },

    async home() {
      await wdaPost('/wda/homescreen');
    },

    async unlock(pin) {
      const locked = await wdaGet('/wda/locked');
      if (!locked.value) return;
      await wdaPost('/wda/unlock');
      await new Promise(r => setTimeout(r, 500));

      // Check if unlock succeeded (no passcode)
      const still = await wdaGet('/wda/locked');
      if (!still.value) return;

      // Passcode required
      const code = pin || passcode;
      if (!code) throw new InvalidArgument('Device requires passcode but none provided');
      await wdaPost(`/session/${sid}/wda/keys`, { value: [...code] });
      await new Promise(r => setTimeout(r, 1000));

      // Verify
      const after = await wdaGet('/wda/locked');
      if (after.value) throw new DeviceError('Unlock failed — wrong passcode?');
    },

    async lock() {
      await wdaPost('/wda/lock');
    },

    async launch(bundleId) {
      await page.unlock(passcode);
      const r = await wdaPost(`/session/${sid}/wda/apps/launch`, { bundleId });
      if (r?.value?.error) throw new DeviceError(`launch(${bundleId}): ${r.value.message}`);
      _refMap = new Map();
    },

    async activate(bundleId) {
      const r = await wdaPost(`/session/${sid}/wda/apps/activate`, { bundleId });
      if (r?.value?.error) throw new DeviceError(`activate(${bundleId}): ${r.value.message}`);
    },

    async screenshot() {
      const r = await wdaGet('/screenshot');
      return Buffer.from(r.value, 'base64');
    },

    async waitForText(text, timeout = 10_000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const snap = await page.snapshot();
        if (snap.includes(text)) return snap;
        await new Promise(r => setTimeout(r, 1000));
      }
      throw new WaitTimeout(`text "${text}"`, timeout);
    },

    /**
     * Resolve once two consecutive snapshots taken `stableMs` apart match.
     * See src/index.js for the Android-side doc comment.
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
        const wKey = typeof ref === 'string' ? Number(ref) : ref;
        const node = _refMap.get(wKey);
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
        await new Promise(r => setTimeout(r, 1000));
      }
      throw new WaitTimeout(`ref ${ref} state "${state}"`, timeout);
    },

    findByText(text) {
      for (const [ref, node] of _refMap) {
        if (node.text?.includes(text) || node.contentDesc?.includes(text)) return ref;
      }
      return null;
    },

    close() {
      cleanup();
    },
  };

  return page;
}
