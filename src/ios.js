// iOS device control via pymobiledevice3 (screenshots, app lifecycle)
// and BLE HID (tap, type, swipe — keyboard + mouse over Bluetooth).

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const execP = promisify(execFile);

const PMD3_PYTHON = 'python3.12';
const BLE_PYTHON = 'python3';
const RSD_FILE = '/tmp/ios-rsd-address';
const POC_SCRIPT = new URL('../test/ios/ble-hid-poc.py', import.meta.url).pathname;

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

// --- BLE HID Daemon ---

class BleHidDaemon {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.kbReady = false;
    this.mouseReady = false;
  }

  async start() {
    const isRoot = process.getuid?.() === 0;
    const cmd = isRoot ? BLE_PYTHON : 'pkexec';
    const args = isRoot ? [POC_SCRIPT] : ['env', 'PYTHONUNBUFFERED=1', BLE_PYTHON, POC_SCRIPT];

    this.proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    this.proc.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('notifications ON')) {
        if (text.includes('KB')) this.kbReady = true;
        if (text.includes('MOUSE')) this.mouseReady = true;
      }
      if (text.includes('Ready.')) this.ready = true;
    });
    this.proc.stderr.on('data', () => {});

    // Wait for "Ready."
    const start = Date.now();
    while (!this.ready && Date.now() - start < 15_000) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (!this.ready) throw new Error('BLE HID daemon did not become ready');
  }

  async ensurePaired(timeout = 120_000) {
    const start = Date.now();
    while ((!this.kbReady || !this.mouseReady) && Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (!this.kbReady || !this.mouseReady) {
      throw new Error(`BLE HID not fully paired — KB: ${this.kbReady}, Mouse: ${this.mouseReady}`);
    }
  }

  send(command) {
    if (!this.proc) throw new Error('BLE HID daemon not started');
    this.proc.stdin.write(command + '\n');
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

  stop() {
    if (!this.proc) return;
    try {
      this.send('quit');
      const p = this.proc;
      setTimeout(() => {
        try { p.kill('SIGTERM'); } catch { /* already dead */ }
      }, 2000);
    } catch { /* already dead */ }
    this.proc = null;
  }
}

// Lazy BLE singleton
let _ble = null;

async function ensureBle() {
  if (_ble) return _ble;
  _ble = new BleHidDaemon();
  await _ble.start();
  await _ble.ensurePaired(120_000);
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

    async screenshot() {
      return takeScreenshot(pythonBin, rsdArgs);
    },

    async launch(bundleId) {
      const result = await pmd3(pythonBin, rsdArgs, 'developer', 'dvt', 'launch', bundleId);
      const pidMatch = result.stdout.match(/(\d+)\s*$/);
      if (!pidMatch) throw new Error(`Could not parse PID from: ${result.stdout.trim()}`);
      return parseInt(pidMatch[1], 10);
    },

    async kill(pid) {
      await pmd3(pythonBin, rsdArgs, 'developer', 'dvt', 'kill', String(pid));
    },

    async tapXY(x, y) {
      const ble = await ensureBle();
      await ble.tapXY(x, y);
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
      // iOS: swipe from left edge to go back
      await page.swipe(5, 400, 200, 400, 300);
    },

    async home() {
      // iOS: swipe up from bottom edge
      await page.swipe(187, 800, 187, 300, 300);
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
        _ble.stop();
        _ble = null;
      }
    },
  };

  // Cleanup on process exit
  process.on('exit', () => {
    if (_ble) {
      _ble.stop();
      _ble = null;
    }
  });

  return page;
}
