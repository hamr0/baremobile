/**
 * Unit tests for daemon-internal behaviors that don't need a real device.
 *
 * Full daemon integration coverage lives in test/integration/cli.test.js
 * and requires an attached Android emulator/device.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { parseTimeout, pushBounded } from '../../src/daemon.js';

describe('pushBounded (Phase 2 fix 2.3)', () => {
  it('grows freely under the cap', () => {
    const a = [];
    for (let i = 0; i < 5; i++) pushBounded(a, i, 10, 2);
    assert.deepEqual(a, [0, 1, 2, 3, 4]);
  });

  it('stays under max while preserving the newest entries', () => {
    const a = [];
    for (let i = 0; i < 12; i++) pushBounded(a, i, 10, 2);
    // Implementation drops `length - max + trim` items on overflow → final
    // length lands at `max - trim` immediately after a trim, then climbs back
    // toward `max` as pushes resume. Newest value is always last.
    assert.ok(a.length <= 10, `length should stay <= max, got ${a.length}`);
    assert.strictEqual(a[a.length - 1], 11);
  });

  it('handles bursts much larger than the cap without quadratic shifts', () => {
    const a = [];
    const max = 1000;
    for (let i = 0; i < 100_000; i++) pushBounded(a, i, max, 100);
    assert.ok(a.length <= max);
    // Last entry is always the latest.
    assert.strictEqual(a[a.length - 1], 99_999);
    // Oldest retained entry is recent (within the last trim window).
    assert.ok(a[0] >= 99_000 - max);
  });
});

describe('parseTimeout (Phase 2 fix 2.1)', () => {
  it('returns undefined when the argument is omitted, null, or whitespace-only', () => {
    assert.strictEqual(parseTimeout(undefined), undefined);
    assert.strictEqual(parseTimeout(null), undefined);
    assert.strictEqual(parseTimeout(''), undefined);
    assert.strictEqual(parseTimeout('   '), undefined);
  });

  it('parses numeric strings and numbers', () => {
    assert.strictEqual(parseTimeout('5000'), 5000);
    assert.strictEqual(parseTimeout(5000), 5000);
    assert.strictEqual(parseTimeout('0'), 0);
  });

  it('throws on malformed input instead of silently coercing to NaN/0', () => {
    for (const bad of ['abc', '5s', '-1', NaN, -10, Infinity, '1e5', '5.5.5']) {
      assert.throws(() => parseTimeout(bad), /Invalid timeout/);
    }
  });
});

describe('daemon close response (Phase 1 fix 1.3)', () => {
  // Structural guard: the close branch must defer process.exit() to the
  // response-flushed callback, otherwise the client sees ECONNRESET in
  // place of `{ok: true}`. If the pattern below is refactored, update both
  // src/daemon.js and this regex together.
  it('source uses res.end(...callback...) for the close path', () => {
    const src = readFileSync('src/daemon.js', 'utf8');
    // We want the close handler to flush body, then close server,
    // then exit. The pattern: res.end(..., () => server.close(... process.exit
    const match = src.match(
      /command === ['"]close['"][\s\S]{0,400}res\.end\([\s\S]+?,\s*\(\)\s*=>\s*\{[\s\S]+?server\.close\(\s*\(\)\s*=>\s*process\.exit/,
    );
    assert.ok(
      match,
      'src/daemon.js close path must defer process.exit() to the res.end() callback',
    );
  });

  // Behavioral guard: the Node.js platform contract we're relying on —
  // res.end(body, cb) fires cb only after the body has been flushed to
  // the socket. If that ever changes (it won't), our fix breaks too.
  it('res.end(body, cb) flushes the body before invoking cb (platform contract)', async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, value: 'hello' }), () => {
        server.close();
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, value: 'hello' });
  });
});
