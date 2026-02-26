import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const PYTHON = 'python3.12';
const RSD_FILE = '/tmp/ios-rsd-address';
const pmd3 = (...args) => exec(PYTHON, ['-m', 'pymobiledevice3', ...args], { timeout: 30000 });

/**
 * Discover RSD tunnel address. Checks (in order):
 * 1. RSD_ADDRESS env var: "host port"
 * 2. /tmp/ios-rsd-address file (written by ios-tunnel.sh)
 * 3. pymobiledevice3 remote browse (tunneld auto-discovery)
 */
async function getRsdArgs() {
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
    const result = await pmd3('remote', 'browse');
    const tunnels = JSON.parse(result.stdout);
    const devices = [...(tunnels.usb || []), ...(tunnels.wifi || [])];
    if (devices.length > 0) {
      const d = devices[0];
      return ['--rsd', d.address, String(d.port)];
    }
  } catch { /* no tunneld running */ }
  return [];
}

describe('iOS pymobiledevice3 spike', () => {
  let device;
  let rsdArgs = [];

  before(async () => {
    const result = await pmd3('usbmux', 'list');
    const devices = JSON.parse(result.stdout);
    assert.ok(devices.length > 0, 'No iPhone connected — plug in via USB');
    device = devices[0];
    rsdArgs = await getRsdArgs();
    if (rsdArgs.length) {
      console.log(`    RSD tunnel: ${rsdArgs[1]}:${rsdArgs[2]}`);
    } else {
      console.log('    No RSD tunnel found — developer service tests may fail');
    }
  });

  it('should detect iPhone via usbmux', () => {
    assert.equal(device.DeviceClass, 'iPhone');
    assert.ok(device.Identifier, 'missing device UDID');
    assert.ok(device.ProductVersion, 'missing iOS version');
    console.log(`    ${device.DeviceName} — iOS ${device.ProductVersion} (${device.ConnectionType})`);
  });

  it('should read device info via lockdown', async () => {
    const result = await pmd3('lockdown', 'info');
    const info = JSON.parse(result.stdout);
    assert.ok(info.DeviceName, 'missing DeviceName');
    assert.ok(info.WiFiAddress, 'missing WiFiAddress');
    assert.ok(info.CPUArchitecture, 'missing CPUArchitecture');
    console.log(`    ${info.CPUArchitecture}, WiFi: ${info.WiFiAddress}`);
  });

  it('should report developer mode status', async () => {
    const result = await pmd3('amfi', 'developer-mode-status');
    const status = result.stdout.trim();
    console.log(`    Developer Mode: ${status}`);
    // Don't assert true — test should run even without dev mode to show status
    assert.match(status, /^(true|false)$/);
  });

  describe('developer services (requires Developer Mode + tunneld)', () => {
    before(async () => {
      const result = await pmd3('amfi', 'developer-mode-status');
      if (result.stdout.trim() !== 'true') {
        // Skip developer tests if dev mode not enabled
        console.log('    Skipping — Developer Mode not enabled');
        return;
      }
    });

    it('should mount developer disk image', async () => {
      try {
        await pmd3('mounter', 'auto-mount');
      } catch (err) {
        if (err.stderr?.includes('already mounted')) return; // fine
        if (err.stderr?.includes('Developer Mode is disabled')) {
          console.log('    Skipped — Developer Mode disabled');
          return;
        }
        throw err;
      }
    });

    it('should take a screenshot', async () => {
      const outPath = join(tmpdir(), `ios-spike-${Date.now()}.png`);
      try {
        await exec(PYTHON, ['-m', 'pymobiledevice3', 'developer', 'dvt', 'screenshot', outPath, ...rsdArgs], {
          timeout: 30000,
        });
        const fileStat = await stat(outPath);
        assert.ok(fileStat.size > 1000, `Screenshot too small: ${fileStat.size} bytes`);
        console.log(`    Screenshot saved: ${outPath} (${(fileStat.size / 1024).toFixed(0)} KB)`);
      } catch (err) {
        if (err.stderr?.includes('Tunneld') || err.stderr?.includes('Developer Mode')) {
          console.log(`    Skipped — ${err.stderr.split('\n')[0]}`);
          return;
        }
        throw err;
      } finally {
        await unlink(outPath).catch(() => {});
      }
    });

    it('should list running processes', async () => {
      try {
        const result = await exec(PYTHON, ['-m', 'pymobiledevice3', 'developer', 'dvt', 'sysmon', 'process', 'single', ...rsdArgs], {
          timeout: 30000, maxBuffer: 50 * 1024 * 1024,
        });
        const output = result.stdout.trim();
        assert.ok(output.length > 0, 'Empty process list');
        console.log(`    Process list received (${(output.length / 1024).toFixed(0)} KB)`);
      } catch (err) {
        if (err.stderr?.includes('Tunneld') || err.stderr?.includes('Developer Mode')) {
          console.log(`    Skipped — ${err.stderr.split('\n')[0]}`);
          return;
        }
        throw err;
      }
    });

    it('should launch and kill an app', async () => {
      const bundleId = 'com.apple.Preferences'; // Settings app — always present
      try {
        // Launch
        const launch = await exec(PYTHON, ['-m', 'pymobiledevice3', 'developer', 'dvt', 'launch', bundleId, ...rsdArgs], {
          timeout: 15000,
        });
        // Output: "Process launched with pid 905" — extract the number
        const pidMatch = launch.stdout.match(/(\d+)\s*$/);
        assert.ok(pidMatch, `Could not parse PID from: ${launch.stdout.trim()}`);
        const pid = pidMatch[1];
        console.log(`    Launched ${bundleId} (pid: ${pid})`);

        // Kill
        await exec(PYTHON, ['-m', 'pymobiledevice3', 'developer', 'dvt', 'kill', pid, ...rsdArgs], {
          timeout: 15000,
        });
        console.log(`    Killed pid ${pid}`);
      } catch (err) {
        if (err.stderr?.includes('Tunneld') || err.stderr?.includes('Developer Mode')) {
          console.log(`    Skipped — ${err.stderr.split('\n')[0]}`);
          return;
        }
        throw err;
      }
    });

    it('should measure screenshot latency', async () => {
      const samples = 3;
      const times = [];
      const outPath = join(tmpdir(), `ios-latency-${Date.now()}.png`);
      try {
        for (let i = 0; i < samples; i++) {
          const start = performance.now();
          await exec(PYTHON, ['-m', 'pymobiledevice3', 'developer', 'dvt', 'screenshot', outPath, ...rsdArgs], {
            timeout: 30000,
          });
          times.push(performance.now() - start);
          await unlink(outPath).catch(() => {});
        }
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        console.log(`    ${samples} screenshots: avg ${avg.toFixed(0)}ms, min ${min.toFixed(0)}ms, max ${max.toFixed(0)}ms`);
        // Sanity: screenshots should complete in under 10s each
        assert.ok(avg < 10000, `Screenshot too slow: avg ${avg.toFixed(0)}ms`);
      } catch (err) {
        if (err.stderr?.includes('Tunneld') || err.stderr?.includes('Developer Mode')) {
          console.log(`    Skipped — ${err.stderr.split('\n')[0]}`);
          return;
        }
        throw err;
      } finally {
        await unlink(outPath).catch(() => {});
      }
    });
  });
});
