/**
 * Phase 2 fix 2.4 — wifi-persist must refuse to load corrupt records that
 * could push attacker-controlled bytes into `adb connect` / subnet scan.
 *
 * Note: loadSavedDevice() reads ~/.config/baremobile/wifi-device.json. To
 * keep these tests hermetic we temporarily redirect $HOME before importing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isValidIpv4 } from '../../src/wifi-persist.js';

describe('isValidIpv4', () => {
  it('accepts well-formed IPv4 addresses', () => {
    for (const ip of ['10.0.0.1', '192.168.1.42', '127.0.0.1', '255.255.255.255', '0.0.0.0']) {
      assert.ok(isValidIpv4(ip), `should accept ${ip}`);
    }
  });

  it('rejects malformed and injection-flavoured inputs', () => {
    for (const bad of [
      '',
      'localhost',
      '1.2.3',
      '1.2.3.4.5',
      '256.0.0.1',
      '999.0.0.1',
      '1.2.3.4:5555',
      '1.2.3.4 || rm -rf /',
      '1.2.3.4; touch /tmp/x',
      '::1',
      null,
      undefined,
      42,
      {},
    ]) {
      assert.strictEqual(isValidIpv4(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe('loadSavedDevice (Phase 2 fix 2.4)', () => {
  function withFakeHome(prepare, body) {
    const tmp = mkdtempSync(join(tmpdir(), 'baremobile-wifi-'));
    const prevHome = process.env.HOME;
    process.env.HOME = tmp;
    const cfgDir = join(tmp, '.config', 'baremobile');
    const cfgFile = join(cfgDir, 'wifi-device.json');
    mkdirSync(cfgDir, { recursive: true });
    if (prepare) prepare(cfgFile);
    return import(`../../src/wifi-persist.js?t=${Date.now()}-${Math.random()}`)
      .then(async (mod) => {
        try {
          await body(mod, cfgFile);
        } finally {
          process.env.HOME = prevHome;
          rmSync(tmp, { recursive: true, force: true });
        }
      });
  }

  it('returns null and deletes the file when the IP is malformed', async () => {
    await withFakeHome(
      (f) => writeFileSync(f, JSON.stringify({ ip: '1.2.3.4; rm -rf /', port: 5555 })),
      async (mod, f) => {
        assert.strictEqual(mod.loadSavedDevice(), null);
        assert.strictEqual(existsSync(f), false, 'corrupt file should be unlinked');
      },
    );
  });

  it('returns null when JSON is corrupt', async () => {
    await withFakeHome(
      (f) => writeFileSync(f, '{not-json'),
      async (mod) => {
        assert.strictEqual(mod.loadSavedDevice(), null);
      },
    );
  });

  it('returns null and deletes when port is out of range', async () => {
    await withFakeHome(
      (f) => writeFileSync(f, JSON.stringify({ ip: '10.0.0.1', port: 99999 })),
      async (mod, f) => {
        assert.strictEqual(mod.loadSavedDevice(), null);
        assert.strictEqual(existsSync(f), false);
      },
    );
  });

  it('returns the record when both fields are valid', async () => {
    await withFakeHome(
      (f) => writeFileSync(f, JSON.stringify({ ip: '192.168.1.50', port: 5555, saved: 0 })),
      async (mod) => {
        assert.deepEqual(mod.loadSavedDevice(), { ip: '192.168.1.50', port: 5555 });
      },
    );
  });

  it('returns null when the file does not exist', async () => {
    await withFakeHome(
      null, // no file written
      async (mod) => {
        assert.strictEqual(mod.loadSavedDevice(), null);
      },
    );
  });
});
