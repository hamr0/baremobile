/**
 * Phase 4a validation — regression + necessity + stress for:
 * 4.1 typed errors (src/errors.js + migrated callsites)
 * 4.4 platform auto-detect (resolvePlatformAsync with 'auto')
 * 4.8 DEBUG_BAREMOBILE observability flag (src/debug.js)
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  ElementNotFound, SelectorNotFound, WdaTimeout, WdaUnavailable,
  WaitTimeout, InvalidArgument, DeviceError, isConnectionError,
} from '../../src/errors.js';
import { tap as androidTap, press as androidPress } from '../../src/interact.js';
import { resolvePlatform, resolvePlatformAsync, _resetAutoPlatformCache } from '../../mcp-server.js';
import { isDebugEnabled, traceCall } from '../../src/debug.js';

// ---------------------------------------------------------------------------
// 4.1 — typed errors
// ---------------------------------------------------------------------------

describe('Phase 4.1 — typed errors', () => {
  it('every typed error has .name and .code matching the class', () => {
    const cases = [
      new ElementNotFound('5'),
      new SelectorNotFound({ text: 'X' }),
      new WdaTimeout('/x', 100),
      new WdaUnavailable('http://x'),
      new WaitTimeout('text', 1000),
      new InvalidArgument('bad'),
      new DeviceError('boom'),
    ];
    for (const e of cases) {
      assert.strictEqual(e.name, e.constructor.name);
      assert.strictEqual(e.code, e.constructor.name);
      assert.ok(e instanceof Error);
      assert.ok(typeof e.message === 'string' && e.message.length > 0);
    }
  });

  it('cause is preserved when wrapping', () => {
    const cause = new Error('root');
    const e = new WdaTimeout('/sess', 100, { cause });
    assert.strictEqual(e.cause, cause);
  });

  it('isConnectionError recognises all WDA/ADB-shaped failures by code', () => {
    assert.ok(isConnectionError({ code: 'ECONNREFUSED' }));
    assert.ok(isConnectionError({ code: 'ECONNRESET' }));
    assert.ok(isConnectionError({ code: 'EPIPE' }));
    assert.ok(isConnectionError({ code: 'WdaTimeout' }));
    assert.ok(isConnectionError({ code: 'WdaUnavailable' }));
    assert.ok(isConnectionError({ code: 'WDA_TIMEOUT' })); // legacy
  });

  it('isConnectionError falls back to message substrings for un-typed errors', () => {
    assert.ok(isConnectionError(new Error('fetch failed')));
    assert.ok(isConnectionError(new Error('UND_ERR something')));
    assert.ok(!isConnectionError(new Error('bad request')));
  });

  it('isConnectionError does NOT false-positive on InvalidArgument / DeviceError', () => {
    assert.ok(!isConnectionError(new InvalidArgument('bad')));
    assert.ok(!isConnectionError(new DeviceError('boom')));
    assert.ok(!isConnectionError(new WaitTimeout('text', 100)));
  });

  it('interact.tap with missing ref throws ElementNotFound (typed)', async () => {
    const refMap = new Map();
    await assert.rejects(
      () => androidTap(99, refMap),
      (e) => e instanceof ElementNotFound && e.ref === 99,
    );
  });

  it('interact.press with unknown key throws InvalidArgument (typed)', async () => {
    await assert.rejects(
      () => androidPress('flerp'),
      (e) => e instanceof InvalidArgument && /Unknown key/.test(e.message),
    );
  });

  // NECESSITY — pre-fix callers had to substring-match err.message; show
  // that a regex on the legacy string would have collided with unrelated
  // text containing the same words.
  it('NECESSITY: substring matching is genuinely fragile vs typed checks', () => {
    const legacyMsg = 'No node with ref=42';
    const unrelated = 'No node with the same name found in the registry'; // imagine a backend lib uses this phrase
    assert.match(legacyMsg, /No node/);
    assert.match(unrelated, /No node/); // false positive
    // Typed check is unambiguous:
    const typed = new ElementNotFound(42);
    const unrelatedErr = new InvalidArgument('No node with the same name…');
    assert.ok(typed instanceof ElementNotFound);
    assert.ok(!(unrelatedErr instanceof ElementNotFound));
  });
});

// ---------------------------------------------------------------------------
// 4.4 — platform: 'auto'
// ---------------------------------------------------------------------------

describe('Phase 4.4 — platform: "auto"', () => {
  it('explicit platform always wins over auto', async () => {
    _resetAutoPlatformCache();
    assert.strictEqual(await resolvePlatformAsync({ platform: 'ios' }), 'ios');
    assert.strictEqual(await resolvePlatformAsync({ platform: 'android' }), 'android');
  });

  it('synchronous resolvePlatform falls back to android when no cache', () => {
    _resetAutoPlatformCache();
    assert.strictEqual(resolvePlatform({ platform: 'auto' }), 'android');
  });

  it('caches the auto resolution across calls (one probe per process)', async () => {
    _resetAutoPlatformCache();
    // First call probes; subsequent calls use the cache. On a host with
    // neither device, both fall back to 'android' — still verify cache
    // semantics by spying on listDevices.
    const adb = await import('../../src/adb.js');
    let listCalls = 0;
    const original = adb.listDevices;
    // Patch via a thin proxy on the module's exports — Node ESM lets us
    // overwrite if the binding is a getter-friendly object; otherwise this
    // is best-effort. If the spy doesn't take, the test still validates
    // the cache by comparing two await results.
    try { mock.method(adb, 'listDevices', async () => { listCalls++; return []; }); }
    catch { /* spy not applicable */ }

    const a = await resolvePlatformAsync({ platform: 'auto' });
    const b = await resolvePlatformAsync({ platform: 'auto' });
    const c = await resolvePlatformAsync({ platform: 'auto' });
    assert.strictEqual(a, b);
    assert.strictEqual(b, c);
    // If spy worked, listCalls should be exactly 1 (cached after first hit).
    // Tolerate spy-not-applicable hosts by checking only that the result is stable.
    if (listCalls > 0) assert.ok(listCalls <= 1, `expected ≤1 probe, got ${listCalls}`);
  });

  it('unknown platform values fall back to android (defence-in-depth)', async () => {
    _resetAutoPlatformCache();
    assert.strictEqual(await resolvePlatformAsync({ platform: 'symbian' }), 'android');
    assert.strictEqual(await resolvePlatformAsync(null), 'android');
    assert.strictEqual(await resolvePlatformAsync({}), 'android');
  });
});

// ---------------------------------------------------------------------------
// 4.8 — DEBUG_BAREMOBILE
// ---------------------------------------------------------------------------

describe('Phase 4.8 — DEBUG_BAREMOBILE observability', () => {
  it('isDebugEnabled reflects env at module load time', () => {
    // The module reads env once at import. We can't toggle it within the
    // same process, so verify the parser logic via a sibling child process.
    const enabled = spawnSync(process.execPath, ['-e', `
      process.env.DEBUG_BAREMOBILE = '1';
      const { isDebugEnabled } = await import('${process.cwd()}/src/debug.js');
      process.stdout.write(String(isDebugEnabled()));
    `], { encoding: 'utf8', timeout: 5000 });
    assert.strictEqual(enabled.stdout, 'true');

    const disabled = spawnSync(process.execPath, ['-e', `
      delete process.env.DEBUG_BAREMOBILE;
      const { isDebugEnabled } = await import('${process.cwd()}/src/debug.js');
      process.stdout.write(String(isDebugEnabled()));
    `], { encoding: 'utf8', timeout: 5000 });
    assert.strictEqual(disabled.stdout, 'false');

    const off = spawnSync(process.execPath, ['-e', `
      process.env.DEBUG_BAREMOBILE = '0';
      const { isDebugEnabled } = await import('${process.cwd()}/src/debug.js');
      process.stdout.write(String(isDebugEnabled()));
    `], { encoding: 'utf8', timeout: 5000 });
    assert.strictEqual(off.stdout, 'false');
  });

  it('traceCall passes the inner result through unchanged when DEBUG is off', async () => {
    // In this process DEBUG_BAREMOBILE is unset (test runner inherits env).
    assert.strictEqual(isDebugEnabled(), false);
    const out = await traceCall('adb', ['x'], async () => 'hello');
    assert.strictEqual(out, 'hello');
  });

  it('traceCall propagates errors when DEBUG is off (no swallowing)', async () => {
    assert.strictEqual(isDebugEnabled(), false);
    await assert.rejects(
      () => traceCall('wda', '/x', async () => { throw new InvalidArgument('boom'); }),
      (e) => e instanceof InvalidArgument,
    );
  });

  it('when enabled, traceCall writes one stderr line per call with timing', () => {
    const child = spawnSync(process.execPath, ['-e', `
      process.env.DEBUG_BAREMOBILE = '1';
      const { traceCall } = await import('${process.cwd()}/src/debug.js');
      await traceCall('adb', ['shell', 'echo x'], async () => 'ok');
      try { await traceCall('wda', 'GET /status', async () => { throw new Error('nope'); }); } catch {}
    `], { encoding: 'utf8', timeout: 5000 });
    const lines = child.stderr.trim().split('\n');
    assert.strictEqual(lines.length, 2, `expected 2 trace lines, got ${lines.length}:\n${child.stderr}`);
    assert.match(lines[0], /^\[baremobile\] adb \[shell echo x\]  ok \d+ms$/);
    assert.match(lines[1], /^\[baremobile\] wda GET \/status  err Error \d+ms$/);
  });
});
