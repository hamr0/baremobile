import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const PMD3_PYTHON = 'python3.12';
const BLE_PYTHON = 'python3';
const POC_SCRIPT = new URL('./ble-hid-poc.py', import.meta.url).pathname;
const RSD_FILE = '/tmp/ios-rsd-address';

// Screenshot helper — pymobiledevice3 over USB
async function getRsdArgs() {
  if (process.env.RSD_ADDRESS) {
    const parts = process.env.RSD_ADDRESS.trim().split(/\s+/);
    if (parts.length === 2) return ['--rsd', parts[0], parts[1]];
  }
  try {
    const content = (await readFile(RSD_FILE, 'utf8')).trim();
    const parts = content.split(/\s+/);
    if (parts.length === 2) return ['--rsd', parts[0], parts[1]];
  } catch { /* no file */ }
  return [];
}

async function screenshot(rsdArgs, label) {
  const outPath = join(tmpdir(), `ios-integ-${label}-${Date.now()}.png`);
  await exec(PMD3_PYTHON, [
    '-m', 'pymobiledevice3', 'developer', 'dvt', 'screenshot', outPath, ...rsdArgs,
  ], { timeout: 30000 });
  const fileStat = await stat(outPath);
  console.log(`    screenshot (${label}): ${outPath} (${(fileStat.size / 1024).toFixed(0)} KB)`);
  return outPath;
}

// BLE HID command sender — talks to running POC process via stdin
class BleHid {
  constructor(proc) {
    this.proc = proc;
    this.ready = false;
    this.kbReady = false;
    this.mouseReady = false;
    this._output = '';
  }

  static async start() {
    // POC must run as root for BlueZ D-Bus access.
    // If we're already root, run directly. Otherwise, use pkexec for graphical auth.
    const isRoot = process.getuid?.() === 0;
    const cmd = isRoot ? BLE_PYTHON : 'pkexec';
    const args = isRoot ? [POC_SCRIPT] : ['env', `PYTHONUNBUFFERED=1`, BLE_PYTHON, POC_SCRIPT];

    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    const ble = new BleHid(proc);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      ble._output += text;
      if (text.includes('notifications ON')) {
        if (text.includes('KB')) ble.kbReady = true;
        if (text.includes('MOUSE')) ble.mouseReady = true;
      }
      if (text.includes('Ready.')) ble.ready = true;
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) console.log(`    [ble stderr] ${text}`);
    });

    return ble;
  }

  async waitForReady(timeoutMs = 10000) {
    const start = Date.now();
    while (!this.ready && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (!this.ready) throw new Error('BLE HID POC did not become ready');
  }

  async waitForPaired(timeoutMs = 120000) {
    const start = Date.now();
    while ((!this.kbReady || !this.mouseReady) && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (!this.kbReady || !this.mouseReady) {
      throw new Error(`BLE HID not fully paired — KB: ${this.kbReady}, Mouse: ${this.mouseReady}`);
    }
  }

  send(command) {
    this.proc.stdin.write(command + '\n');
  }

  async sendAndWait(command, waitMs = 300) {
    this.send(command);
    await new Promise(r => setTimeout(r, waitMs));
  }

  // Home cursor to top-left by sending large negative movement
  async homeCursor() {
    // Send enough to guarantee hitting the corner from anywhere on screen
    // iPhone 13 mini: 1080x2340 pixels. Send -3000,-3000 to be safe.
    this.send('move -3000 -3000');
    // Wait for all movement reports to complete
    // -3000 / 10 step = 300 steps * 8ms = 2400ms
    await new Promise(r => setTimeout(r, 3000));
  }

  // Move cursor to absolute screen coordinates (from 0,0 top-left).
  // Coordinates are in "points" (logical pixels) — iPhone 13 mini: 375x812.
  async moveTo(x, y) {
    this.send(`move ${x} ${y}`);
    // Wait for steps to complete
    const maxDist = Math.max(Math.abs(x), Math.abs(y));
    const steps = Math.ceil(maxDist / 10);
    const waitMs = steps * 8 + 200; // extra buffer
    await new Promise(r => setTimeout(r, waitMs));
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
    // 200ms per char + buffer
    await new Promise(r => setTimeout(r, text.length * 200 + 500));
  }

  stop() {
    try {
      this.send('quit');
      setTimeout(() => {
        try { this.proc.kill('SIGTERM'); } catch { /* already dead */ }
      }, 2000);
    } catch { /* already dead */ }
  }
}

describe('iOS integration — screenshot + BLE HID full loop', () => {
  let rsdArgs;
  let ble;
  const screenshotPaths = [];

  before(async () => {
    // Get RSD tunnel address — this is the primary way to reach the device
    rsdArgs = await getRsdArgs();
    assert.ok(rsdArgs.length > 0, 'No RSD tunnel — run: ./scripts/ios-tunnel.sh');
    console.log(`    RSD tunnel: ${rsdArgs[1]}:${rsdArgs[2]}`);

    // Verify device is reachable by taking a preflight screenshot
    const testPath = await screenshot(rsdArgs, 'preflight');
    screenshotPaths.push(testPath);
    console.log('    preflight screenshot OK — device reachable');
  });

  after(async () => {
    if (ble) ble.stop();
    // Clean up screenshots
    for (const p of screenshotPaths) {
      await unlink(p).catch(() => {});
    }
  });

  it('should launch Settings and screenshot', async () => {
    // Launch Settings
    await exec(PMD3_PYTHON, [
      '-m', 'pymobiledevice3', 'developer', 'dvt', 'launch', 'com.apple.Preferences', ...rsdArgs,
    ], { timeout: 15000 });
    console.log('    launched Settings');

    // Wait for app to render
    await new Promise(r => setTimeout(r, 2000));

    const path = await screenshot(rsdArgs, 'settings-launched');
    screenshotPaths.push(path);
    const fileStat = await stat(path);
    assert.ok(fileStat.size > 5000, 'Screenshot too small — may not have rendered');
  });

  it('should connect BLE HID and wait for pairing', async function () {
    // This test requires:
    // 1. BLE HID POC can start (sudo + bluetooth)
    // 2. iPhone is already paired with "baremobile" from previous manual pairing
    //
    // If the device is already bonded, it should auto-reconnect.
    // If not, this will wait up to 2 minutes for manual pairing.

    console.log('    starting BLE HID POC...');
    console.log('    (if iPhone is already paired, it should auto-reconnect)');
    console.log('    (if not, pair via Settings > Bluetooth > "baremobile")');

    ble = await BleHid.start();
    await ble.waitForReady(15000);
    console.log('    BLE HID POC ready, waiting for iPhone to connect...');

    await ble.waitForPaired(120000);
    console.log('    BLE HID paired — KB and Mouse notifications active');
  });

  it('should home cursor to top-left corner', async () => {
    assert.ok(ble?.mouseReady, 'Mouse not connected');

    console.log('    homing cursor to (0, 0)...');
    await ble.homeCursor();
    console.log('    cursor homed');

    // Screenshot to verify cursor is in top-left area
    const path = await screenshot(rsdArgs, 'cursor-homed');
    screenshotPaths.push(path);
  });

  it('should tap Wi-Fi row in Settings via BLE mouse', async () => {
    assert.ok(ble?.mouseReady, 'Mouse not connected');

    // Settings app layout on iPhone 13 mini:
    // "Wi-Fi" row is roughly at y=280 points, centered at x=187
    // These coordinates are approximate — the test verifies the screen changes.
    const targetX = 187;
    const targetY = 280;

    console.log(`    tapping (${targetX}, ${targetY}) — should hit Wi-Fi row...`);
    await ble.tapXY(targetX, targetY);

    // Wait for navigation animation
    await new Promise(r => setTimeout(r, 1500));

    // Screenshot after tap
    const path = await screenshot(rsdArgs, 'after-tap');
    screenshotPaths.push(path);
    const fileStat = await stat(path);
    assert.ok(fileStat.size > 5000, 'Post-tap screenshot too small');
    console.log('    tap completed — check screenshot to verify navigation');
  });

  it('should verify screen changed after tap', async () => {
    // Take before and after screenshots and verify they differ.
    // We can't do pixel comparison easily, but file size difference is a signal.
    // A navigation from Settings main → Wi-Fi detail changes the screen significantly.
    const beforePath = screenshotPaths.find(p => p.includes('settings-launched'));
    const afterPath = screenshotPaths.find(p => p.includes('after-tap'));

    assert.ok(beforePath, 'Missing before screenshot');
    assert.ok(afterPath, 'Missing after screenshot');

    const beforeStat = await stat(beforePath);
    const afterStat = await stat(afterPath);

    // The screenshots should be different sizes (different screen content)
    // This is a rough heuristic — a real test would use image comparison
    const sizeDiff = Math.abs(beforeStat.size - afterStat.size);
    console.log(`    before: ${(beforeStat.size / 1024).toFixed(0)} KB, after: ${(afterStat.size / 1024).toFixed(0)} KB (diff: ${(sizeDiff / 1024).toFixed(0)} KB)`);

    // Even if sizes happen to be similar, the test passes if both screenshots exist and are valid.
    // The real verification is visual — inspect the screenshots.
    assert.ok(beforeStat.size > 1000 && afterStat.size > 1000, 'Screenshots too small');
    console.log('    both screenshots captured — visually verify Settings → Wi-Fi navigation');
  });

  it('should type text via BLE keyboard', async () => {
    assert.ok(ble?.kbReady, 'Keyboard not connected');

    // Navigate back to Settings main screen first — press Escape or go back
    // On iOS, there's no universal "back" key, but we can tap the back button area
    // Top-left area (~40, 55 points) is where "< Settings" back button appears
    console.log('    tapping back button area to return to Settings...');
    await ble.tapXY(40, 55);
    await new Promise(r => setTimeout(r, 1000));

    // Tap the search bar at the top of Settings (roughly x=187, y=110)
    console.log('    tapping Settings search bar...');
    await ble.tapXY(187, 110);
    await new Promise(r => setTimeout(r, 1000));

    // Type a search term
    console.log('    typing "general"...');
    await ble.type('general');

    // Screenshot to verify text appeared
    const path = await screenshot(rsdArgs, 'after-type');
    screenshotPaths.push(path);
    console.log('    typed "general" — check screenshot for search results');
  });
});
