// Public API — connect(opts) → page object, snapshot(opts) one-shot

import { listDevices, exec, shell, dumpXml, screenSize } from './adb.js';
import { parseXml } from './xml.js';
import { prune } from './prune.js';
import { formatTree } from './aria.js';
import * as interact from './interact.js';

/**
 * One-shot snapshot: dump + parse + prune + format.
 * @param {{serial?: string}} [opts]
 * @returns {Promise<string>} YAML snapshot
 */
export async function snapshot(opts = {}) {
  const xml = await dumpXml(opts);
  const root = parseXml(xml);
  if (!root) throw new Error('Failed to parse XML tree');
  const { tree } = prune(root);
  if (!tree) throw new Error('Entire tree pruned away');
  return formatTree(tree);
}

/**
 * Connect to a device and return a page object.
 * @param {{device?: string}} [opts] — device serial or 'auto' (default)
 * @returns {Promise<object>} page
 */
export async function connect(opts = {}) {
  // Resolve device serial
  let serial = opts.device;
  if (!serial || serial === 'auto') {
    const devices = await listDevices();
    if (devices.length === 0) throw new Error('No ADB devices found. Is a device/emulator connected?');
    serial = devices[0].serial;
  }

  const adbOpts = { serial };
  let _refMap = new Map();

  const page = {
    serial,

    async snapshot() {
      const xml = await dumpXml(adbOpts);
      const root = parseXml(xml);
      if (!root) throw new Error('Failed to parse XML tree');
      const { tree, refMap } = prune(root);
      if (!tree) throw new Error('Entire tree pruned away');
      _refMap = refMap;
      return formatTree(tree);
    },

    async tap(ref) {
      await interact.tap(ref, _refMap, adbOpts);
    },

    async type(ref, text, opts = {}) {
      await interact.type(ref, text, _refMap, { ...adbOpts, ...opts });
    },

    async press(key) {
      await interact.press(key, adbOpts);
    },

    async swipe(x1, y1, x2, y2, duration) {
      await interact.swipe(x1, y1, x2, y2, duration, adbOpts);
    },

    async scroll(ref, direction) {
      await interact.scroll(ref, direction, _refMap, adbOpts);
    },

    async longPress(ref) {
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
      await shell(`am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${pkg}`, adbOpts);
    },

    async screenshot() {
      return exec(['exec-out', 'screencap -p'], { serial, timeout: 10_000, encoding: 'buffer' });
    },

    close() {
      // ADB is stateless — no-op for now, keeps API compatible with future daemon
    },
  };

  return page;
}
