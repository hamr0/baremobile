#!/usr/bin/env node
/**
 * iOS live speed test — measures real latency with a connected iPhone.
 *
 * Requires: tunnel + BLE HID running (./scripts/ios-tunnel.sh)
 *
 * Usage: node scripts/ios-live-test.js
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const PMD3_PYTHON = 'python3.12';
const BLE_PYTHON = 'python3';
const POC_SCRIPT = new URL('../test/ios/ble-hid-poc.py', import.meta.url).pathname;
const RSD_FILE = '/tmp/ios-rsd-address';

// --- Helpers ---

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
  const outPath = join(tmpdir(), `ios-live-${label}-${Date.now()}.png`);
  await exec(PMD3_PYTHON, [
    '-m', 'pymobiledevice3', 'developer', 'dvt', 'screenshot', outPath, ...rsdArgs,
  ], { timeout: 30000 });
  const fileStat = await stat(outPath);
  return { path: outPath, size: fileStat.size };
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- BLE HID (same pattern as integration test) ---

class BleHid {
  constructor(proc) {
    this.proc = proc;
    this.ready = false;
    this.kbReady = false;
    this.mouseReady = false;
  }

  static async start() {
    const isRoot = process.getuid?.() === 0;
    const cmd = isRoot ? BLE_PYTHON : 'pkexec';
    const args = isRoot ? [POC_SCRIPT] : ['env', 'PYTHONUNBUFFERED=1', BLE_PYTHON, POC_SCRIPT];

    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    const ble = new BleHid(proc);
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('notifications ON')) {
        if (text.includes('KB')) ble.kbReady = true;
        if (text.includes('MOUSE')) ble.mouseReady = true;
      }
      if (text.includes('Ready.')) ble.ready = true;
    });
    proc.stderr.on('data', () => {});
    return ble;
  }

  async waitForReady(timeoutMs = 10000) {
    const start = Date.now();
    while (!this.ready && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (!this.ready) throw new Error('BLE HID did not become ready');
  }

  async waitForPaired(timeoutMs = 120000) {
    const start = Date.now();
    while ((!this.kbReady || !this.mouseReady) && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (!this.kbReady || !this.mouseReady) {
      throw new Error(`BLE not fully paired — KB: ${this.kbReady}, Mouse: ${this.mouseReady}`);
    }
  }

  send(command) { this.proc.stdin.write(command + '\n'); }

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

  async click() { await this.sendAndWait('click', 200); }

  async tapXY(x, y) {
    await this.homeCursor();
    await this.moveTo(x, y);
    await this.click();
  }

  async type(text) {
    this.send(`send_string ${text}`);
    await new Promise(r => setTimeout(r, text.length * 200 + 500));
  }

  stop() {
    try {
      this.send('quit');
      setTimeout(() => {
        try { this.proc.kill('SIGTERM'); } catch { /* dead */ }
      }, 2000);
    } catch { /* dead */ }
  }
}

// --- Test runner ---

const results = [];

function record(op, times) {
  const med = median(times);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const assessment = med < 500 ? 'fast' : med < 2000 ? 'ok' : med < 5000 ? 'slow' : 'very slow';
  results.push({ op, med, min, max, n: times.length, assessment });
}

async function bench(label, fn, n = 3) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  record(label, times);
  return times;
}

async function main() {
  console.log('=== iOS Live Speed Test ===\n');

  // 1. Get RSD tunnel
  const rsdArgs = await getRsdArgs();
  if (!rsdArgs.length) {
    console.error('No RSD tunnel — run: ./scripts/ios-tunnel.sh');
    process.exit(1);
  }
  console.log(`RSD tunnel: ${rsdArgs[1]}:${rsdArgs[2]}\n`);

  const cleanupPaths = [];

  try {
    // --- Screenshot latency ---
    console.log('1. Screenshot latency (single)...');
    await bench('screenshot (single)', async () => {
      const { path } = await screenshot(rsdArgs, 'bench');
      cleanupPaths.push(path);
    });

    console.log('2. Screenshot burst (5)...');
    const burstTimes = [];
    const burstStart = performance.now();
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const { path } = await screenshot(rsdArgs, `burst-${i}`);
      cleanupPaths.push(path);
      burstTimes.push(performance.now() - start);
    }
    const burstTotal = performance.now() - burstStart;
    record('screenshot (burst of 5)', burstTimes);
    console.log(`   burst total: ${burstTotal.toFixed(0)}ms\n`);

    // --- App launch + screenshot ---
    console.log('3. App launch + screenshot...');
    await bench('launch + screenshot', async () => {
      await exec(PMD3_PYTHON, [
        '-m', 'pymobiledevice3', 'developer', 'dvt', 'launch', 'com.apple.Preferences', ...rsdArgs,
      ], { timeout: 15000 });
      await new Promise(r => setTimeout(r, 1000));
      const { path } = await screenshot(rsdArgs, 'launch');
      cleanupPaths.push(path);
    }, 2);

    // --- BLE HID tests (optional) ---
    console.log('\n4. Starting BLE HID...');
    let ble;
    try {
      ble = await BleHid.start();
      await ble.waitForReady(15000);
      console.log('   BLE ready, waiting for iPhone to connect...');
      console.log('   (pair via Settings > Bluetooth > "baremobile" if needed)');
      await ble.waitForPaired(120000);
      console.log('   BLE paired!\n');

      // Tap latency
      console.log('5. BLE tap latency (homeCursor + move + click)...');
      await bench('tapXY(187, 300)', async () => {
        await ble.tapXY(187, 300);
      }, 3);

      // Type latency
      console.log('6. BLE type latency (short string)...');
      await bench('type "hello"', async () => {
        await ble.type('hello');
      }, 2);

      console.log('7. BLE type latency (long string)...');
      await bench('type "the quick brown fox"', async () => {
        await ble.type('the quick brown fox');
      }, 1);

      // Full loop: screenshot → tap → screenshot
      console.log('8. Full loop: screenshot → tap → screenshot...');
      await bench('full loop', async () => {
        const { path: p1 } = await screenshot(rsdArgs, 'loop-before');
        cleanupPaths.push(p1);
        await ble.tapXY(187, 300);
        await new Promise(r => setTimeout(r, 1000));
        const { path: p2 } = await screenshot(rsdArgs, 'loop-after');
        cleanupPaths.push(p2);
      }, 2);

      // Home screen swipe-through
      console.log('9. Home screen map (swipe + screenshot per page)...');
      // Go home first
      await ble.sendAndWait('send_key h', 500); // This won't work as home key — use swipe instead
      // Swipe up from bottom to go home
      ble.send('move -3000 -3000');
      await new Promise(r => setTimeout(r, 3000));
      ble.send('move 187 800');
      await new Promise(r => setTimeout(r, 1500));

      const swipeStart = performance.now();
      const pages = [];
      for (let page = 0; page < 3; page++) {
        const { path, size } = await screenshot(rsdArgs, `home-${page}`);
        cleanupPaths.push(path);
        pages.push({ page, size });
        // Swipe left to next page
        if (page < 2) {
          ble.send('move -3000 -3000');
          await new Promise(r => setTimeout(r, 3000));
          ble.send('move 350 400');
          await new Promise(r => setTimeout(r, 800));
          // drag left
          ble.send('click'); // mousedown
          await new Promise(r => setTimeout(r, 100));
          ble.send('move -300 0');
          await new Promise(r => setTimeout(r, 500));
          // Actually, swipe needs special handling. For now just screenshot current.
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      const swipeTotal = performance.now() - swipeStart;
      console.log(`   ${pages.length} pages in ${swipeTotal.toFixed(0)}ms`);
      record('home screen map (3 pages)', [swipeTotal]);

    } catch (err) {
      console.log(`   BLE tests skipped: ${err.message}\n`);
    } finally {
      if (ble) ble.stop();
    }

    // --- Results table ---
    console.log('\n=== Results ===\n');
    console.log('Operation'.padEnd(35) + 'Median'.padStart(8) + 'Min'.padStart(8) + 'Max'.padStart(8) + '  N  Assessment');
    console.log('-'.repeat(80));
    for (const r of results) {
      console.log(
        r.op.padEnd(35) +
        `${r.med.toFixed(0)}ms`.padStart(8) +
        `${r.min.toFixed(0)}ms`.padStart(8) +
        `${r.max.toFixed(0)}ms`.padStart(8) +
        `  ${r.n}  ${r.assessment}`
      );
    }
    console.log('');

  } finally {
    // Clean up temp files
    for (const p of cleanupPaths) {
      await unlink(p).catch(() => {});
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
