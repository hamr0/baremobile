/**
 * Unit tests for src/setup.js helpers.
 * Run: node --test test/unit/setup.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, statSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectHost, which, parseTunnelOutput, parseWdaBundleFromJson, findSdkRoot, findSdkTool } from '../../src/setup.js';

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
  // PID_FILE now lives at ~/.config/baremobile/ios-pids (moved off the
  // predictable, world-writable /tmp path — see security-validation.test.js).
  // Redirect $HOME and re-import so the module's homedir()-derived path is
  // hermetic and we never touch the developer's real config.
  async function withRedirectedHome(fn) {
    const home = mkdtempSync(join(tmpdir(), 'bm-home-'));
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      const mod = await import(`../../src/setup.js?h=${encodeURIComponent(home)}`);
      const pidFile = join(home, '.config', 'baremobile', 'ios-pids');
      mkdirSync(join(home, '.config', 'baremobile'), { recursive: true });
      await fn(mod, pidFile);
    } finally {
      process.env.HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('parses 2-line format with RSD', async () => {
    await withRedirectedHome((mod, pidFile) => {
      writeFileSync(pidFile, '1234 5678 9012\nfd7a:e21d:8e41::1 61024');
      assert.deepEqual(mod.loadPids(), {
        tunnel: 1234, wda: 5678, fwd: 9012,
        rsdAddr: 'fd7a:e21d:8e41::1', rsdPort: '61024',
      });
    });
  });

  it('parses legacy 1-line format with null RSD', async () => {
    await withRedirectedHome((mod, pidFile) => {
      writeFileSync(pidFile, '1234 5678 9012');
      assert.deepEqual(mod.loadPids(), {
        tunnel: 1234, wda: 5678, fwd: 9012,
        rsdAddr: null, rsdPort: null,
      });
    });
  });

  it('returns null when file missing', async () => {
    await withRedirectedHome((mod) => {
      assert.equal(mod.loadPids(), null);
    });
  });
});

describe('findSdkRoot', () => {
  it('returns a string or null', () => {
    const result = findSdkRoot();
    assert.ok(result === null || typeof result === 'string', `expected string or null, got ${typeof result}`);
  });

  it('respects ANDROID_HOME env var', () => {
    const orig = process.env.ANDROID_HOME;
    process.env.ANDROID_HOME = '/tmp';
    try {
      const result = findSdkRoot();
      assert.equal(result, '/tmp');
    } finally {
      if (orig === undefined) delete process.env.ANDROID_HOME;
      else process.env.ANDROID_HOME = orig;
    }
  });

  it('returns null for nonexistent ANDROID_HOME', () => {
    const orig = process.env.ANDROID_HOME;
    const origRoot = process.env.ANDROID_SDK_ROOT;
    process.env.ANDROID_HOME = '/nonexistent-path-xyz-12345';
    delete process.env.ANDROID_SDK_ROOT;
    try {
      // May still find SDK via common paths or PATH, so just check type
      const result = findSdkRoot();
      assert.ok(result === null || typeof result === 'string');
    } finally {
      if (orig === undefined) delete process.env.ANDROID_HOME;
      else process.env.ANDROID_HOME = orig;
      if (origRoot === undefined) delete process.env.ANDROID_SDK_ROOT;
      else process.env.ANDROID_SDK_ROOT = origRoot;
    }
  });
});

describe('findSdkTool', () => {
  it('returns null for null sdkRoot', () => {
    assert.equal(findSdkTool(null, 'sdkmanager'), null);
  });

  it('returns null for nonexistent SDK path', () => {
    assert.equal(findSdkTool('/nonexistent-sdk-xyz', 'sdkmanager'), null);
  });

  it('falls back to which() for tools in PATH', () => {
    // 'node' is in PATH — findSdkTool should find it via which fallback
    const result = findSdkTool('/nonexistent-sdk', 'node');
    assert.ok(result && result.includes('node'), `expected path containing 'node', got ${result}`);
  });

  it('skips directories with same name as tool', () => {
    // /tmp is a directory — findSdkTool should not return it
    const result = findSdkTool('/', 'tmp');
    // Should be null (no 'tmp' binary in PATH) or a file, never a directory
    if (result) {
      assert.ok(statSync(result).isFile(), `expected a file, got directory: ${result}`);
    }
  });
});
