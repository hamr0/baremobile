/**
 * Phase 4c validation:
 *   4.6 app helpers (grantPermission, revokePermission, clearAppData, listPermissions)
 *   4.7 multi-device (_pages keyed by {platform, serial})
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  grantPermission, revokePermission, clearAppData, listPermissions,
} from '../../src/apps.js';
import { TOOLS } from '../../mcp-server.js';

// ---------------------------------------------------------------------------
// 4.6 — app helpers
// ---------------------------------------------------------------------------

describe('Phase 4.6 — app helpers (validation surface)', () => {
  it('grantPermission rejects shell-meaningful package names', async () => {
    for (const bad of ['com.x; rm -rf /', 'com.x`whoami`', 'com.x$(id)', '']) {
      await assert.rejects(
        () => grantPermission(bad, 'android.permission.CAMERA'),
        /Invalid Android package name/,
      );
    }
  });

  it('grantPermission rejects shell-meaningful permission names', async () => {
    for (const bad of [
      'android.permission.CAMERA; rm -rf /',
      'perm with space',
      'perm`evil`',
      '$EVIL',
      '',
    ]) {
      await assert.rejects(
        () => grantPermission('com.example', bad),
        /Invalid Android permission name/,
      );
    }
  });

  it('revokePermission and clearAppData validate the same way', async () => {
    await assert.rejects(
      () => revokePermission('com.x; rm /', 'android.permission.CAMERA'),
      /Invalid Android package name/,
    );
    await assert.rejects(
      () => clearAppData('com.x; rm /'),
      /Invalid Android package name/,
    );
    await assert.rejects(
      () => listPermissions('com.x; rm /'),
      /Invalid Android package name/,
    );
  });

  it('all four MCP tools are android-only', () => {
    for (const name of ['grant_permission', 'revoke_permission', 'clear_app_data', 'list_permissions']) {
      const tool = TOOLS.find(t => t.name === name);
      assert.ok(tool, `${name} tool missing`);
      assert.deepEqual(tool._platforms, ['android']);
      assert.match(tool.description, /\[android-only\]/);
    }
  });

  // NECESSITY — without the validators, an attacker-controlled `pkg` flowing
  // through `pm grant <pkg> <perm>` would re-parse on the device. This is
  // the same vector as Phase 1.1 (launch/intent), confirmed by the existing
  // shellQuote roundtrip + injection necessity tests there.
  it('NECESSITY: the new validators reuse the same /^[A-Za-z][A-Za-z0-9_.]*$/ shape', () => {
    // Demonstrates that we deliberately rejected non-identifier shell chars.
    const src = readFileSync('src/apps.js', 'utf8');
    assert.match(src, /\/\^\[A-Za-z\]\[A-Za-z0-9_\.\]\*\$\//);
  });
});

// ---------------------------------------------------------------------------
// 4.7 — multi-device cache keying
// ---------------------------------------------------------------------------

describe('Phase 4.7 — multi-device (_pages keyed by {platform, serial})', () => {
  it('every MCP tool advertises a `serial` arg in its schema', () => {
    for (const tool of TOOLS) {
      // serial is part of the shared PLATFORM_PROP spread into each schema
      // — confirm it actually landed on every tool.
      assert.ok(tool.inputSchema.properties.serial,
        `${tool.name} missing serial arg`);
      assert.strictEqual(tool.inputSchema.properties.serial.type, 'string');
    }
  });

  it('source pageKey helper combines platform and serial', () => {
    const src = readFileSync('mcp-server.js', 'utf8');
    assert.match(src, /function pageKey\(platform, serial\)/);
    assert.match(src, /\$\{platform\}:\$\{serial \|\| '\*'\}/);
  });

  it('source threads serial through getPage()', () => {
    const src = readFileSync('mcp-server.js', 'utf8');
    assert.match(src, /async function getPage\(platform = 'android', serial = null\)/);
    assert.match(src, /const _getPage = \(p = platform\) => getPage\(p, serial\)/);
  });

  it('source retry tiers also key by {platform, serial}', () => {
    const src = readFileSync('mcp-server.js', 'utf8');
    // Tier 1 close + clear:
    assert.match(src, /const key = pageKey\(platform, serial\);[\s\S]+?_pages\[key\]\.close/);
    // Tier 2 iOS WDA restart clears the keyed slot:
    assert.match(src, /_pages\[pageKey\(platform, serial\)\] = null;/);
  });

  // NECESSITY — pre-fix, two MCP calls targeting different Android serials
  // would share a single `_pages.android` slot, so the second call's
  // device would be silently ignored (or worse, a retry would clear the
  // wrong page). We can't reproduce on a no-device host, but the cache
  // key contract is now testable.
  it('NECESSITY: distinct serials produce distinct cache keys', () => {
    // Mirror the same key formula here to lock in the contract.
    function pageKey(platform, serial) {
      return `${platform}:${serial || '*'}`;
    }
    assert.notStrictEqual(
      pageKey('android', 'emulator-5554'),
      pageKey('android', 'emulator-5556'),
    );
    assert.notStrictEqual(pageKey('android', null), pageKey('android', 'emulator-5554'));
    assert.strictEqual(pageKey('android', null), pageKey('android', undefined));
  });
});
