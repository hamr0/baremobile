/**
 * Unit tests for src/setup.js helpers.
 * Run: node --test test/unit/setup.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { detectHost, which, parseTunnelOutput, parseWdaBundleFromJson, loadPids } from '../../src/setup.js';

describe('detectHost', () => {
  it('returns an object with os and pkg', () => {
    const host = detectHost();
    assert.ok(['linux', 'macos', 'wsl'].includes(host.os), `os should be linux/macos/wsl, got ${host.os}`);
    assert.ok(host.pkg === null || ['dnf', 'apt', 'brew'].includes(host.pkg), `pkg should be dnf/apt/brew/null, got ${host.pkg}`);
  });

  it('os matches process.platform', () => {
    const host = detectHost();
    if (process.platform === 'darwin') {
      assert.equal(host.os, 'macos');
    } else {
      assert.ok(host.os === 'linux' || host.os === 'wsl');
    }
  });
});

describe('which', () => {
  it('returns full path for node', () => {
    const result = which('node');
    assert.ok(result, 'should return a path');
    assert.ok(result.includes('node'), `path should contain "node", got ${result}`);
  });

  it('returns null for nonexistent binary', () => {
    assert.equal(which('nonexistent-binary-xyz-12345'), null);
  });
});

describe('parseTunnelOutput', () => {
  it('parses RSD Address and RSD Port', () => {
    const text = `
INFO:pymobiledevice3.cli.lockdown:tunnel created
INFO:pymobiledevice3.cli.lockdown:RSD Address: fd7a:e21d:8e41::1
INFO:pymobiledevice3.cli.lockdown:RSD Port: 61024
`;
    const result = parseTunnelOutput(text);
    assert.deepEqual(result, { rsdAddr: 'fd7a:e21d:8e41::1', rsdPort: '61024' });
  });

  it('parses --rsd format', () => {
    const text = 'Use --rsd fd7a:e21d:8e41::1 61024 to connect';
    const result = parseTunnelOutput(text);
    assert.deepEqual(result, { rsdAddr: 'fd7a:e21d:8e41::1', rsdPort: '61024' });
  });

  it('returns null for unrelated text', () => {
    const result = parseTunnelOutput('no tunnel info here');
    assert.equal(result, null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseTunnelOutput(''), null);
  });
});

describe('parseWdaBundleFromJson', () => {
  it('finds WebDriverAgent bundle', () => {
    const json = JSON.stringify({
      'com.apple.Preferences': {},
      'com.facebook.WebDriverAgentRunner.xctrunner.FL2J4LNPJ2': {},
      'com.apple.mobilesafari': {},
    });
    const result = parseWdaBundleFromJson(json);
    assert.equal(result, 'com.facebook.WebDriverAgentRunner.xctrunner.FL2J4LNPJ2');
  });

  it('returns null when no WDA installed', () => {
    const json = JSON.stringify({
      'com.apple.Preferences': {},
      'com.apple.mobilesafari': {},
    });
    assert.equal(parseWdaBundleFromJson(json), null);
  });

  it('returns null for invalid JSON', () => {
    assert.equal(parseWdaBundleFromJson('not json'), null);
  });

  it('returns null for empty object', () => {
    assert.equal(parseWdaBundleFromJson('{}'), null);
  });
});

describe('loadPids', () => {
  const PID_FILE = '/tmp/baremobile-ios-pids';

  it('parses 2-line format with RSD', () => {
    writeFileSync(PID_FILE, '1234 5678 9012\nfd7a:e21d:8e41::1 61024');
    const result = loadPids();
    assert.deepEqual(result, {
      tunnel: 1234, wda: 5678, fwd: 9012,
      rsdAddr: 'fd7a:e21d:8e41::1', rsdPort: '61024',
    });
    unlinkSync(PID_FILE);
  });

  it('parses legacy 1-line format with null RSD', () => {
    writeFileSync(PID_FILE, '1234 5678 9012');
    const result = loadPids();
    assert.deepEqual(result, {
      tunnel: 1234, wda: 5678, fwd: 9012,
      rsdAddr: null, rsdPort: null,
    });
    unlinkSync(PID_FILE);
  });

  it('returns null when file missing', () => {
    try { unlinkSync(PID_FILE); } catch { /* already gone */ }
    assert.equal(loadPids(), null);
  });
});
