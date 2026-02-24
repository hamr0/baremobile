import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const PYTHON = 'python3.12';
const pmd3 = (...args) => exec(PYTHON, ['-m', 'pymobiledevice3', ...args], { timeout: 30000 });

/** Discover RSD tunnel address from tunneld or env var. Returns ['--rsd', host, port] or []. */
async function getRsdArgs() {
  // Allow override via env: RSD_ADDRESS="host port" (space-separated, IPv6 safe)
  if (process.env.RSD_ADDRESS) {
    const parts = process.env.RSD_ADDRESS.trim().split(/\s+/);
    if (parts.length === 2) return ['--rsd', parts[0], parts[1]];
  }
  try {
    const result = await pmd3('remote', 'browse');
    const tunnels = JSON.parse(result.stdout);
    // Check USB tunnels first, then WiFi
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
          timeout: 30000,
        });
        const output = result.stdout.trim();
        assert.ok(output.length > 0, 'Empty process list');
        console.log(`    Process list received (${output.split('\n').length} lines)`);
      } catch (err) {
        if (err.stderr?.includes('Tunneld') || err.stderr?.includes('Developer Mode')) {
          console.log(`    Skipped — ${err.stderr.split('\n')[0]}`);
          return;
        }
        throw err;
      }
    });
  });
});
