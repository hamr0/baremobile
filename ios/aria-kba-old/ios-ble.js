// iOS device control via pymobiledevice3 (screenshots, app lifecycle)
// and BLE HID (tap, type, swipe — keyboard + mouse over Bluetooth).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { openSync, writeSync, closeSync, existsSync } from 'node:fs';

const execP = promisify(execFile);

const PMD3_PYTHON = 'python3.12';
const RSD_FILE = '/tmp/ios-rsd-address';
const AX_SCRIPT = new URL('../scripts/ios-ax.py', import.meta.url).pathname;

// --- RSD tunnel resolution ---

/**
 * Discover RSD tunnel address. Checks (in order):
 * 1. RSD_ADDRESS env var: "host port"
 * 2. /tmp/ios-rsd-address file (written by ios-tunnel.sh)
 * 3. pymobiledevice3 remote browse (tunneld auto-discovery)
 */
async function resolveRsd(pythonBin = PMD3_PYTHON) {
  // 1. Env var
  if (process.env.RSD_ADDRESS) {
    const parts = process.env.RSD_ADDRESS.trim().split(/\s+/);
    if (parts.length === 2) return ['--rsd', parts[0], parts[1]];
  }
  // 2. RSD file from ios-tunnel.sh
  try {
    const content = (await readFile(RSD_FILE, 'utf8')).trim();
    const parts = content.split(/\s+/);
    if (parts.length === 2) return ['--rsd', parts[0], parts[1]];
  } catch { /* file doesn't exist */ }
  // 3. tunneld auto-discovery
  try {
    const result = await pmd3(pythonBin, [], 'remote', 'browse');
    const tunnels = JSON.parse(result.stdout);
    const devices = [...(tunnels.usb || []), ...(tunnels.wifi || [])];
    if (devices.length > 0) {
      const d = devices[0];
      return ['--rsd', d.address, String(d.port)];
    }
  } catch { /* no tunneld running */ }
  return [];
}

// --- pymobiledevice3 command runner ---

async function pmd3(pythonBin, rsdArgs, ...args) {
  return execP(pythonBin, ['-m', 'pymobiledevice3', ...args, ...rsdArgs], {
    timeout: 30_000,
    maxBuffer: 50 * 1024 * 1024,
  });
}

// --- Screenshot ---

async function takeScreenshot(pythonBin, rsdArgs) {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readFile: readF, unlink } = await import('node:fs/promises');

  const outPath = join(tmpdir(), `ios-screenshot-${Date.now()}.png`);
  await execP(pythonBin, [
    '-m', 'pymobiledevice3', 'developer', 'dvt', 'screenshot', outPath, ...rsdArgs,
  ], { timeout: 30_000 });
  const buf = await readF(outPath);
  await unlink(outPath).catch(() => {});
  return buf;
}

// --- Accessibility snapshot ---

// iPhone screen layout constants (points, 3x Retina)
const SCREEN_W = 375;     // logical width in points
const SCREEN_H = 812;     // logical height in points

// BLE mouse coordinate calibration (iPhone 13 mini, Settings)
// BLE mouse units ≠ screen points — cursor acceleration means ~3-4x scaling.
// Calibrated by probing: ref=1 ~200, ref=3 ~500, ref=5 ~600, ref=8 ~800.
// Regular rows (ref>=3): Y = 500 + (ref - 3) * 50
const BLE_ROW_START = 500;  // BLE Y for first regular row (ref=3 in Settings)
const BLE_ROW_H = 50;       // BLE Y units per row
const BLE_X_CENTER = 187;   // center X in BLE coords

/**
 * Estimate BLE mouse tap coordinates for an element by ref index.
 * Calibrated for list layouts (Settings, etc.).
 * @param {number} ref — element index from snapshot
 * @param {number} total — total element count (unused for now)
 * @returns {{x: number, y: number}}
 */
export function estimateTapTarget(ref, total) {
  if (ref === 0) return { x: BLE_X_CENTER, y: 80 };
  if (ref === 1) return { x: BLE_X_CENTER, y: 200 };
  if (ref === 2) return { x: BLE_X_CENTER, y: 320 };
  // Regular rows from ref=3 onward
  const y = BLE_ROW_START + (ref - 3) * BLE_ROW_H;
  return { x: BLE_X_CENTER, y };
}

/**
 * Format parsed accessibility elements as YAML with [ref=N] markers.
 * Matches the Android snapshot format from aria.js.
 * @param {Array<object>} elements — parsed from ios-ax.py dump
 * @returns {string}
 */
export function formatSnapshot(elements) {
  const lines = [];
  for (const el of elements) {
    let line = `- ${el.role || 'View'}`;
    line += ` [ref=${el.ref}]`;
    if (el.label) line += ` "${el.label}"`;
    if (el.value) line += ` (${el.value})`;
    if (el.traits && el.traits.length) line += ` [${el.traits.join(', ')}]`;
    lines.push(line);
  }
  return lines.join('\n');
}

async function axDump(pythonBin, rsdArgs) {
  const host = rsdArgs[1];
  const port = rsdArgs[2];
  const { stdout } = await execP(pythonBin, [AX_SCRIPT, '--rsd', host, port, 'dump'], {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

// --- BLE HID via FIFO ---
// The BLE HID POC runs externally (needs sudo). We send commands via a FIFO.

const BLE_FIFO = '/tmp/ios-ble-hid.fifo';

class BleHidFifo {
  constructor() {
    this.fd = null;
  }

  async connect() {
    // Wait for FIFO to exist (BLE POC creates it)
    const start = Date.now();
    while (!existsSync(BLE_FIFO) && Date.now() - start < 5_000) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (!existsSync(BLE_FIFO)) {
      throw new Error(`BLE HID FIFO not found at ${BLE_FIFO} — is ble-hid-poc.py running?`);
    }
    this.fd = openSync(BLE_FIFO, 'w');
  }

  send(command) {
    if (this.fd === null) throw new Error('BLE FIFO not connected');
    writeSync(this.fd, command + '\n');
  }

  async sendAndWait(command, waitMs = 300) {
    this.send(command);
    await new Promise(r => setTimeout(r, waitMs));
  }

  async homeCursor() {
    this.send('move -3000 -3000');
    await new Promise(r => setTimeout(r, 3000));
  }

  async moveTo(x, y) {
    this.send(`move ${x} ${y}`);
    const maxDist = Math.max(Math.abs(x), Math.abs(y));
    const steps = Math.ceil(maxDist / 10);
    await new Promise(r => setTimeout(r, steps * 8 + 200));
  }

  async click() {
    await this.sendAndWait('click', 200);
  }

  async moveBy(dx, dy) {
    this.send(`move ${dx} ${dy}`);
    const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.ceil(maxDist / 10);
    await new Promise(r => setTimeout(r, steps * 8 + 200));
  }

  async scroll(amount) {
    this.send(`scroll ${amount}`);
    await new Promise(r => setTimeout(r, Math.abs(amount) * 50 + 200));
  }

  async tapXY(x, y) {
    await this.homeCursor();
    await this.moveTo(x, y);
    await this.click();
  }

  async type(text) {
    this.send(`send_string ${text}`);
    await new Promise(r => setTimeout(r, text.length * 200 + 500));
  }

  async pressKey(key) {
    await this.sendAndWait(`send_key ${key}`, 300);
  }

  close() {
    if (this.fd !== null) {
      try { closeSync(this.fd); } catch { /* already closed */ }
      this.fd = null;
    }
  }
}

// iOS roles that FKA can focus on (interactive/clickable)
const FKA_INTERACTIVE = new Set([
  'Cell', 'Button', 'Switch', 'TextField', 'SecureTextField',
  'SearchField', 'Link', 'Tab', 'SegmentedControl', 'Slider',
  'Toggle', 'Checkbox', 'MenuItem', 'Stepper', 'Picker',
]);

// Lazy BLE singleton
let _ble = null;
// Cached elements from last snapshot (used by tap to compute FKA position)
let _lastElements = null;

async function ensureBle() {
  if (_ble) return _ble;
  _ble = new BleHidFifo();
  await _ble.connect();
  return _ble;
}

// --- Public API ---

/**
 * Connect to an iOS device and return a page object.
 * Requires ios-tunnel.sh running (or RSD_ADDRESS env var).
 *
 * @param {{pythonBin?: string}} [opts]
 * @returns {Promise<object>} page
 */
export async function connect(opts = {}) {
  const pythonBin = opts.pythonBin || PMD3_PYTHON;
  const rsdArgs = await resolveRsd(pythonBin);
  if (!rsdArgs.length) {
    throw new Error('No RSD tunnel — run: ./scripts/ios-tunnel.sh');
  }

  // Get device UDID
  let serial = 'unknown';
  try {
    const result = await pmd3(pythonBin, [], 'usbmux', 'list');
    const devices = JSON.parse(result.stdout);
    if (devices.length > 0) serial = devices[0].Identifier;
  } catch { /* couldn't get UDID */ }

  const page = {
    serial,
    platform: 'ios',

    async snapshot() {
      const elements = await axDump(pythonBin, rsdArgs);
      _lastElements = elements;
      return formatSnapshot(elements);
    },

    async tap(ref) {
      const ble = await ensureBle();

      if (!_lastElements) {
        _lastElements = await axDump(pythonBin, rsdArgs);
      }

      // FKA Tab enters the main list group (skips nav bar, profile section).
      // The main group starts at the first Cell/Toggle element.
      const GROUP_ROLES = new Set(['Cell', 'Toggle', 'Switch']);
      const groupStart = _lastElements.findIndex(el => GROUP_ROLES.has(el.role));
      const startIdx = groupStart === -1 ? 0 : groupStart;

      // Count interactive elements within the main group up to the target ref.
      const groupItems = _lastElements.slice(startIdx).filter(el => FKA_INTERACTIVE.has(el.role));
      const pos = groupItems.findIndex(el => el.ref === ref);
      if (pos === -1) {
        const el = _lastElements.find(el => el.ref === ref);
        throw new Error(`tap(${ref}): "${el?.label}" (${el?.role}) not in main FKA group`);
      }

      // Re-launch app to reset FKA focus to known state
      if (page._bundleId) {
        await page.launch(page._bundleId);
        await new Promise(r => setTimeout(r, 1500));
      }

      // Tab enters group (no item focused). Down×(pos+1) reaches target.
      await ble.pressKey('tab');
      await new Promise(r => setTimeout(r, 300));
      for (let i = 0; i <= pos; i++) {
        await ble.pressKey('down');
        await new Promise(r => setTimeout(r, 150));
      }
      await ble.pressKey('space');
      await new Promise(r => setTimeout(r, 500));

      _lastElements = null;
    },

    async waitForText(text, timeout = 10_000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const snap = await page.snapshot();
        if (snap.includes(text)) return snap;
        await new Promise(r => setTimeout(r, 1000));
      }
      throw new Error(`waitForText("${text}") timed out after ${timeout}ms`);
    },

    async screenshot() {
      return takeScreenshot(pythonBin, rsdArgs);
    },

    async launch(bundleId) {
      const result = await pmd3(pythonBin, rsdArgs, 'developer', 'dvt', 'launch', bundleId);
      const pidMatch = result.stdout.match(/(\d+)\s*$/);
      if (!pidMatch) throw new Error(`Could not parse PID from: ${result.stdout.trim()}`);
      page._bundleId = bundleId;
      _lastElements = null;
      return parseInt(pidMatch[1], 10);
    },

    async kill(pid) {
      await pmd3(pythonBin, rsdArgs, 'developer', 'dvt', 'kill', String(pid));
    },

    async tapXY(x, y) {
      const ble = await ensureBle();
      await ble.tapXY(x, y);
    },

    async moveCursor(dx, dy) {
      const ble = await ensureBle();
      await ble.moveBy(dx, dy);
    },

    async dwellTap(dx, dy, dwellMs = 1800) {
      const ble = await ensureBle();
      await ble.moveBy(dx, dy);
      await new Promise(r => setTimeout(r, dwellMs));
    },

    async scroll(direction, amount = 3) {
      const ble = await ensureBle();
      const val = direction === 'up' ? amount : -amount;
      await ble.scroll(val);
    },

    async type(text) {
      const ble = await ensureBle();
      await ble.type(text);
    },

    async press(key) {
      const ble = await ensureBle();
      await ble.pressKey(key);
    },

    async swipe(x1, y1, x2, y2, duration = 300) {
      const ble = await ensureBle();
      // Home cursor, move to start, then drag to end
      await ble.homeCursor();
      await ble.moveTo(x1, y1);
      // Mouse down
      ble.send('click'); // press
      await new Promise(r => setTimeout(r, 100));
      // Move to destination (relative from current position)
      const dx = x2 - x1;
      const dy = y2 - y1;
      ble.send(`move ${dx} ${dy}`);
      const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
      const steps = Math.ceil(maxDist / 10);
      await new Promise(r => setTimeout(r, Math.max(duration, steps * 8 + 200)));
      // Release — send zero-button report
      // Note: the POC click command does press+release, so for drag we
      // need the actual mouse report. For now, this is approximate.
    },

    async back() {
      // iOS FKA: Escape goes back (same as swipe-from-left)
      const ble = await ensureBle();
      await ble.pressKey('escape');
      await new Promise(r => setTimeout(r, 500));
    },

    async home() {
      // iOS FKA: Tab+H = go to home screen (Tab acts as command key in FKA)
      // Both keys pressed simultaneously in one HID report
      const ble = await ensureBle();
      await ble.sendAndWait('send_combo tab h', 1000);
    },

    async longPressXY(x, y, ms = 1000) {
      const ble = await ensureBle();
      await ble.homeCursor();
      await ble.moveTo(x, y);
      // Mouse down and hold
      ble.send('click');
      await new Promise(r => setTimeout(r, ms));
    },

    close() {
      if (_ble) {
        _ble.close();
        _ble = null;
      }
    },
  };

  // Cleanup on process exit
  process.on('exit', () => {
    if (_ble) {
      _ble.close();
      _ble = null;
    }
  });

  return page;
}
