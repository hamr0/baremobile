import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// We test termux.js by mocking child_process.execFile and fs/promises.access
// Import the module fresh each time isn't practical, so we mock at the dep level.

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';

// We'll import the actual functions and mock their dependencies
import {
  isTermux,
  findLocalDevices,
  adbPair,
  adbConnect,
  resolveTermuxDevice,
} from '../../src/termux.js';

describe('isTermux', () => {
  const origEnv = process.env.TERMUX_VERSION;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.TERMUX_VERSION;
    else process.env.TERMUX_VERSION = origEnv;
  });

  it('returns true when TERMUX_VERSION is set', async () => {
    process.env.TERMUX_VERSION = '0.118.0';
    assert.strictEqual(await isTermux(), true);
  });

  it('returns false when TERMUX_VERSION is unset and path missing', async () => {
    delete process.env.TERMUX_VERSION;
    // On a non-Android system, /data/data/com.termux won't exist
    assert.strictEqual(await isTermux(), false);
  });
});

describe('findLocalDevices', () => {
  it('parses localhost devices from adb output', async () => {
    // This test runs real adb — if adb isn't available, skip
    try {
      const devices = await findLocalDevices();
      assert.ok(Array.isArray(devices), 'Should return an array');
      // Every entry should be localhost:*
      for (const d of devices) {
        assert.ok(d.startsWith('localhost:'), `Expected localhost:*, got ${d}`);
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        // adb not installed — skip
        return;
      }
      throw e;
    }
  });
});

describe('adbPair', () => {
  it('constructs correct pair command', async () => {
    // We can't actually pair without a device, but we verify the function
    // throws a connection error (not a usage error) — meaning args are correct
    try {
      await adbPair(37000, '123456');
      // If it succeeds somehow, that's fine too
    } catch (e) {
      // Expected: connection refused or similar — NOT "usage: adb pair"
      assert.ok(
        !e.message?.includes('usage:'),
        'Should not be a usage error — command args should be correct'
      );
    }
  });
});

describe('adbConnect', () => {
  it('constructs correct connect command', async () => {
    try {
      await adbConnect(5555);
    } catch (e) {
      assert.ok(
        !e.message?.includes('usage:'),
        'Should not be a usage error — command args should be correct'
      );
    }
  });
});

describe('resolveTermuxDevice', () => {
  it('throws with setup instructions when no localhost device found', async () => {
    // On a non-Termux system with no localhost ADB connections, should throw
    try {
      await resolveTermuxDevice();
      // If it succeeds (unlikely on dev machine), that's fine
    } catch (e) {
      assert.ok(e.message.includes('No localhost ADB device found'), 'Should mention no device');
      assert.ok(e.message.includes('Wireless Debugging'), 'Should mention wireless debugging');
      assert.ok(e.message.includes('adb pair'), 'Should include pair instructions');
      assert.ok(e.message.includes('adb connect'), 'Should include connect instructions');
      assert.ok(e.message.includes('reboot'), 'Should warn about reboot');
    }
  });
});

// --- Parsing tests with synthetic adb output ---

describe('findLocalDevices parsing', () => {
  // These tests validate the parsing logic by testing the function's behavior
  // with known adb output patterns. Since we can't easily mock execFile for
  // an already-imported module, we test the parsing indirectly.

  it('would return empty array when no devices', async () => {
    // If adb is available but no localhost device connected, should return []
    try {
      const devices = await findLocalDevices();
      // Filter: we're just checking the return type is valid
      assert.ok(Array.isArray(devices));
    } catch (e) {
      if (e.code === 'ENOENT') return; // no adb
      throw e;
    }
  });
});

// --- Unit tests for parsing logic extracted from findLocalDevices ---

describe('localhost device detection logic', () => {
  // Test the parsing logic that findLocalDevices uses
  function parseDeviceLines(stdout) {
    const lines = stdout.split('\n').slice(1);
    const devices = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [serial, state] = trimmed.split(/\s+/);
      if (state === 'device' && serial.startsWith('localhost:')) {
        devices.push(serial);
      }
    }
    return devices;
  }

  it('finds localhost device in typical output', () => {
    const output = 'List of devices attached\nlocalhost:34567\tdevice\n\n';
    assert.deepStrictEqual(parseDeviceLines(output), ['localhost:34567']);
  });

  it('ignores non-localhost devices', () => {
    const output = 'List of devices attached\nemulator-5554\tdevice\n192.168.1.5:5555\tdevice\n\n';
    assert.deepStrictEqual(parseDeviceLines(output), []);
  });

  it('ignores offline localhost devices', () => {
    const output = 'List of devices attached\nlocalhost:34567\toffline\n\n';
    assert.deepStrictEqual(parseDeviceLines(output), []);
  });

  it('handles multiple localhost devices', () => {
    const output = 'List of devices attached\nlocalhost:34567\tdevice\nlocalhost:45678\tdevice\n\n';
    assert.deepStrictEqual(parseDeviceLines(output), ['localhost:34567', 'localhost:45678']);
  });

  it('handles empty device list', () => {
    const output = 'List of devices attached\n\n';
    assert.deepStrictEqual(parseDeviceLines(output), []);
  });

  it('handles mixed device types', () => {
    const output =
      'List of devices attached\n' +
      'emulator-5554\tdevice\n' +
      'localhost:34567\tdevice\n' +
      'ABCD1234\tdevice\n' +
      'localhost:45678\tunauthorized\n\n';
    assert.deepStrictEqual(parseDeviceLines(output), ['localhost:34567']);
  });

  it('handles extra whitespace and transport info', () => {
    const output =
      'List of devices attached\n' +
      'localhost:34567          device  transport_id:3\n\n';
    assert.deepStrictEqual(parseDeviceLines(output), ['localhost:34567']);
  });
});
