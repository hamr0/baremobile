/**
 * Security-validation tests — regression guards for the findings fixed in the
 * 2026-05-29 security pass:
 *   M1  daemon /command now requires a per-session token            (daemon.js)
 *   L2  predictable /tmp files moved to ~/.config/baremobile (ios-cert.js, setup.js)
 *   L3  cmdline-tools download/extract uses mkdtemp, not fixed /tmp (setup.js)
 *   L4  daemon /command caps the request body size                  (daemon.js)
 *
 * Run: node --test test/unit/security-validation.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkToken, createCommandServer } from '../../src/daemon.js';

const SRC = new URL('../../src/', import.meta.url);
const read = (f) => readFileSync(new URL(f, SRC), 'utf8');

describe('M1 — checkToken gates /command', () => {
  const TOKEN = 'a'.repeat(64);
  const req = (val) => ({ headers: val === undefined ? {} : { 'x-baremobile-token': val } });

  it('accepts the exact token', () => {
    assert.equal(checkToken(req(TOKEN), TOKEN), true);
  });
  it('rejects a missing token header', () => {
    assert.equal(checkToken(req(undefined), TOKEN), false);
  });
  it('rejects a wrong token of the same length', () => {
    assert.equal(checkToken(req('b'.repeat(64)), TOKEN), false);
  });
  it('rejects a token of a different length (no throw)', () => {
    assert.equal(checkToken(req('short'), TOKEN), false);
  });
  it('rejects a non-string (array) header without throwing', () => {
    assert.equal(checkToken({ headers: { 'x-baremobile-token': ['a', 'b'] } }, TOKEN), false);
  });
});

describe('M1/L4 — daemon /command server enforces auth, body cap, and dispatch', () => {
  // Boots the REAL createCommandServer (the same factory runDaemon uses) with
  // fake handlers, so these assert actual HTTP behavior — not source text.
  const TOKEN = 'deadbeef'.repeat(8);
  const handlers = { ping: async (args) => ({ ok: true, echo: args }) };

  async function withServer(fn) {
    const server = createCommandServer(TOKEN, handlers);
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
    const { port } = server.address();
    try {
      await fn(port);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  }

  const post = (port, { token, body } = {}) =>
    fetch(`http://127.0.0.1:${port}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-baremobile-token': token } : {}) },
      body: body ?? JSON.stringify({ command: 'ping', args: { a: 1 } }),
    });

  it('rejects /command without a token (401)', async () => {
    await withServer(async (port) => {
      const res = await post(port, {});
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { ok: false, error: 'Unauthorized' });
    });
  });

  it('rejects a wrong token of the same length (401)', async () => {
    await withServer(async (port) => {
      assert.equal((await post(port, { token: 'b'.repeat(64) })).status, 401);
    });
  });

  it('dispatches a valid command with the correct token (200)', async () => {
    await withServer(async (port) => {
      const res = await post(port, { token: TOKEN });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, echo: { a: 1 } });
    });
  });

  it('rejects an over-cap body before dispatch (413)', async () => {
    await withServer(async (port) => {
      // > 1 MiB of single-byte chars — trips the byte-accurate cap.
      const huge = JSON.stringify({ command: 'ping', args: { blob: 'x'.repeat(1024 * 1024 + 16) } });
      assert.equal((await post(port, { token: TOKEN, body: huge })).status, 413);
    });
  });

  it('rejects invalid JSON even with the correct token (400)', async () => {
    await withServer(async (port) => {
      assert.equal((await post(port, { token: TOKEN, body: 'not json' })).status, 400);
    });
  });

  it('rejects an unknown command (400)', async () => {
    await withServer(async (port) => {
      const body = JSON.stringify({ command: 'nope' });
      assert.equal((await post(port, { token: TOKEN, body })).status, 400);
    });
  });

  it('GET /status is an open liveness probe (200, no token)', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).ok, true);
    });
  });

  it('returns 404 for any other route', async () => {
    await withServer(async (port) => {
      assert.equal((await fetch(`http://127.0.0.1:${port}/nope`, { method: 'POST' })).status, 404);
    });
  });
});

describe('M1 — daemon mints a token and the client sends it', () => {
  it('daemon writes a random per-session token into session.json', () => {
    const src = read('daemon.js');
    assert.match(src, /randomBytes\(32\)\.toString\('hex'\)/);
    assert.match(src, /platform,\s*\n\s*token,/);
  });
  it('session-client posts the x-baremobile-token header from session.token', () => {
    assert.match(read('session-client.js'), /'x-baremobile-token':\s*session\.token/);
  });
});

describe('L2 — ios-cert uses ~/.config, not /tmp', () => {
  it('source has no /tmp path', () => {
    assert.doesNotMatch(read('ios-cert.js'), /\/tmp\//);
  });

  it('recordIosSigning writes under $HOME/.config/baremobile; checkIosCert reads it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bm-home-'));
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      // Fresh import (query-string cache-bust) so module-level homedir()
      // re-evaluates against the redirected HOME.
      const mod = await import(`../../src/ios-cert.js?home=${encodeURIComponent(home)}`);
      mod.recordIosSigning();
      const expected = join(home, '.config', 'baremobile', 'ios-signed');
      assert.ok(existsSync(expected), `expected signing record at ${expected}`);
      assert.ok(!existsSync('/tmp/baremobile-ios-signed'), 'must not write the old /tmp path');
      assert.equal(mod.checkIosCert(), null, 'a freshly-signed cert should not warn');
    } finally {
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('L2/L3 — setup.js has no predictable /tmp paths', () => {
  const src = read('setup.js');

  it('PID file no longer uses a fixed /tmp path', () => {
    assert.doesNotMatch(src, /\/tmp\/baremobile-ios-pids/);
  });
  it('cmdline-tools no longer use fixed /tmp paths', () => {
    assert.doesNotMatch(src, /\/tmp\/android-cmdline/);
  });
  it('cmdline-tools extraction uses an unpredictable mkdtemp dir', () => {
    assert.match(src, /mkdtempSync\(join\(tmpdir\(\)/);
  });
});
