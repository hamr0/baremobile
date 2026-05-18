/**
 * Stress validation for Phase 1 + Phase 2 fixes.
 *
 * Regression tests (one path per fix) live alongside each module's other
 * tests. This file pushes each fix harder: fuzzes inputs, runs concurrent
 * scenarios, and asserts external contracts (e.g. POSIX shell parses our
 * quoted output back to the original byte sequence).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

import {
  shellQuote, validatePackage, validateIntentAction, validateExtraKey,
} from '../../src/adb.js';
import { parseTimeout, pushBounded } from '../../src/daemon.js';
import { isValidIpv4 } from '../../src/wifi-persist.js';
import { resolvePlatform } from '../../mcp-server.js';
import { connect as iosConnect } from '../../src/ios.js';

// ---------------------------------------------------------------------------
// 1.1 Shell injection — shellQuote round-trips through real /bin/sh
// ---------------------------------------------------------------------------

describe('STRESS 1.1 — shellQuote survives /bin/sh roundtrip', () => {
  // Use /bin/sh -c "printf %s <quoted>" and confirm stdout equals input.
  // If our quoting is broken anywhere, the shell either errors or returns
  // a different byte sequence — both detected here.
  function roundtrip(input) {
    const quoted = shellQuote(input);
    const out = execFileSync('/bin/sh', ['-c', `printf %s ${quoted}`], {
      encoding: 'buffer',
      timeout: 5000,
    });
    return out.toString('utf8');
  }

  it('handles every printable ASCII character', () => {
    for (let i = 0x20; i < 0x7f; i++) {
      const ch = String.fromCharCode(i);
      assert.strictEqual(roundtrip(ch), ch, `ASCII 0x${i.toString(16)} (${ch})`);
    }
  });

  it('handles the known nasty metacharacters', () => {
    const cases = [
      `'`, `"`, '`', '$', '$()', '$(id)', '$(rm -rf /)',
      '`whoami`', '; rm -rf /', '&& touch /tmp/x', '|| evil',
      '> /etc/passwd', '< /dev/null', '| cat',
      '$IFS', '\\\\', '\\n', '\\t',
      'a b c', '\t\n\r',
      `'; DROP TABLE users; --`,
      `' OR '1'='1`,
    ];
    for (const v of cases) {
      assert.strictEqual(roundtrip(v), v, JSON.stringify(v));
    }
  });

  it('handles 500 random byte strings (binary-clean except for NUL)', () => {
    for (let i = 0; i < 500; i++) {
      // exclude NUL — shell argv can't carry it and Node will refuse anyway
      const len = 1 + (i % 16);
      let s;
      do {
        s = randomBytes(len).toString('binary');
      } while (s.includes('\0'));
      assert.strictEqual(roundtrip(s), s);
    }
  });

  it('handles unicode (multi-byte UTF-8)', () => {
    const cases = [
      'café', '日本語', '한국어', '🤖🚀', 'Ω≈ç√∫˜µ', 'O​Brien' /* zero-width */,
    ];
    for (const v of cases) {
      assert.strictEqual(roundtrip(v), v, v);
    }
  });
});

// ---------------------------------------------------------------------------
// 1.1 Validators reject every adversarial payload we can dream up
// ---------------------------------------------------------------------------

describe('STRESS 1.1 — validators reject every shell-meaningful payload', () => {
  const METACHARS = [
    ';', '&', '|', '`', '$', '(', ')', '<', '>',
    ' ', '\t', '\n', '\r', "'", '"', '\\',
    '*', '?', '[', ']', '{', '}', '~', '#', '!',
  ];

  it('validatePackage rejects every payload that contains a shell metacharacter', () => {
    for (const c of METACHARS) {
      // Use a valid prefix so we know the metachar is what trips the regex.
      assert.throws(() => validatePackage(`com.x${c}y`), /Invalid Android package name/,
        `metachar ${JSON.stringify(c)} should be rejected`);
    }
  });

  it('validateIntentAction rejects every payload that contains a shell metacharacter', () => {
    for (const c of METACHARS) {
      assert.throws(() => validateIntentAction(`a.b${c}c`), /Invalid intent action/);
    }
  });

  it('validateExtraKey rejects every payload that contains a shell metacharacter', () => {
    for (const c of METACHARS) {
      assert.throws(() => validateExtraKey(`k${c}v`), /Invalid intent extra key/);
    }
  });

  it('accepts every realistic valid package name (1000 generated)', () => {
    for (let i = 0; i < 1000; i++) {
      const parts = 1 + (i % 5);
      const pkg = Array.from({ length: parts }, (_, j) =>
        'a' + (j === 0 ? '' : i.toString(36)) + j).join('.');
      assert.doesNotThrow(() => validatePackage(pkg), `generated: ${pkg}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 1.2 iOS connect — concurrent failure storms must all clean up
// ---------------------------------------------------------------------------

describe('STRESS 1.2 — iOS connect concurrent failures', () => {
  it('20 simultaneous /session-failing connects all reject within the bound', async () => {
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ value: { ready: true } }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ value: { error: 'boom' } }));
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    try {
      const t0 = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => iosConnect({ host: '127.0.0.1', port })),
      );
      const elapsed = Date.now() - t0;
      for (const r of results) {
        assert.strictEqual(r.status, 'rejected', 'each connect must reject');
      }
      // 20 sequential WDA-retry-ladders would dominate — confirm they really
      // run concurrently (well under 20× a single attempt's worst case).
      assert.ok(elapsed < 15_000, `concurrent connects elapsed=${elapsed}ms`);
    } finally {
      server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 1.3 Daemon close response — repeat platform contract 100×
// ---------------------------------------------------------------------------

describe('STRESS 1.3 — res.end(body, cb) keeps body intact across 100 iterations', () => {
  it('100 short-lived servers each return their full body before closing', async () => {
    for (let i = 0; i < 100; i++) {
      const server = createServer((req, res) => {
        const body = JSON.stringify({ ok: true, n: i });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body, () => server.close());
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address();
      const got = await (await fetch(`http://127.0.0.1:${port}/`)).json();
      assert.deepEqual(got, { ok: true, n: i });
    }
  });
});

// ---------------------------------------------------------------------------
// 1.4 WDA fetch timeout — many hung connects must all fail fast
// ---------------------------------------------------------------------------

describe('STRESS 1.4 — concurrent hung WDA requests all timeout fast', () => {
  it('10 connects against a hanging /session timeout under a tight bound', async () => {
    process.env.BAREMOBILE_WDA_TIMEOUT_MS = '150';
    const url = new URL('../../src/ios.js', import.meta.url);
    const { connect } = await import(`${url.href}?stress=${Date.now()}`);

    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ value: { ready: true } }));
      }
      // Anything else: hang forever.
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();

    try {
      const t0 = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => connect({ host: '127.0.0.1', port })),
      );
      const elapsed = Date.now() - t0;
      for (const r of results) {
        assert.strictEqual(r.status, 'rejected');
        const msg = r.reason?.message || '';
        assert.ok(/timed out/i.test(msg) || r.reason?.code === 'WDA_TIMEOUT',
          `expected timeout-shaped error, got: ${msg}`);
      }
      // 3 attempts × 150ms + 2 × 500ms backoff = ~1.45s per attempt.
      // Concurrent should complete well within 4s.
      assert.ok(elapsed < 5000, `concurrent hung connects elapsed=${elapsed}ms`);
    } finally {
      server.close();
      delete process.env.BAREMOBILE_WDA_TIMEOUT_MS;
    }
  });
});

// ---------------------------------------------------------------------------
// 2.1 parseTimeout — exhaustive fuzz
// ---------------------------------------------------------------------------

describe('STRESS 2.1 — parseTimeout fuzz', () => {
  it('any negative-prefixed numeric string is rejected', () => {
    for (let i = 1; i < 100; i++) {
      assert.throws(() => parseTimeout(`-${i}`), /Invalid timeout/);
    }
  });

  it('any non-numeric ASCII char inside a number is rejected', () => {
    for (const c of '!@#$%^&*()_+=[]{}|\\;:\'",<>?/`~ ') {
      assert.throws(() => parseTimeout(`5${c}5`), /Invalid timeout/, c);
    }
  });

  it('integer round-trip on 500 random numbers', () => {
    for (let i = 0; i < 500; i++) {
      const n = Math.floor(Math.random() * 1_000_000);
      assert.strictEqual(parseTimeout(String(n)), n);
      assert.strictEqual(parseTimeout(n), n);
    }
  });

  it('rejects exponent notation, hex, octal — anything non-decimal', () => {
    for (const bad of ['1e3', '0x10', '0o17', '0b101', 'NaN', 'Infinity', '+5']) {
      assert.throws(() => parseTimeout(bad), /Invalid timeout/, bad);
    }
  });
});

// ---------------------------------------------------------------------------
// 2.3 pushBounded — invariants under randomised loads
// ---------------------------------------------------------------------------

describe('STRESS 2.3 — pushBounded invariants', () => {
  it('length never exceeds max regardless of burst size and timing', () => {
    for (let trial = 0; trial < 10; trial++) {
      const max = 100 + Math.floor(Math.random() * 1000);
      const trim = 1 + Math.floor(Math.random() * (max - 1));
      const a = [];
      const N = 50_000;
      for (let i = 0; i < N; i++) {
        pushBounded(a, i, max, trim);
        assert.ok(a.length <= max, `trial=${trial} i=${i} len=${a.length} > max=${max}`);
      }
      // Always retains the most recent entry.
      assert.strictEqual(a[a.length - 1], N - 1);
    }
  });

  it('first overflow trims down to (max - trim), keeping newest', () => {
    // Implementation: when length > max, splice(0, length - max + trim).
    // Starting at length=max and pushing one more: length=max+1, drop
    // (1 + trim) so final length = max - trim. The +trim drop is what
    // amortises future pushes to O(1) — without it we'd re-trim per push.
    const max = 10;
    const trim = 3;
    const a = [];
    for (let i = 0; i < 10; i++) pushBounded(a, i, max, trim);
    assert.strictEqual(a.length, 10);
    pushBounded(a, 10, max, trim);
    assert.strictEqual(a.length, max - trim);
    assert.strictEqual(a[a.length - 1], 10);
    // Oldest survivor is index = (1 + trim) into the original sequence.
    assert.strictEqual(a[0], 1 + trim);
  });
});

// ---------------------------------------------------------------------------
// 2.4 isValidIpv4 — boundary fuzz
// ---------------------------------------------------------------------------

describe('STRESS 2.4 — isValidIpv4 boundaries', () => {
  it('accepts every legal octet boundary', () => {
    for (const v of ['0.0.0.0', '255.255.255.255', '1.2.3.4', '10.0.0.1']) {
      assert.ok(isValidIpv4(v));
    }
    // Each octet from 0 to 255
    for (let i = 0; i <= 255; i++) {
      assert.ok(isValidIpv4(`${i}.0.0.0`), `octet ${i}`);
      assert.ok(isValidIpv4(`0.${i}.0.0`), `octet ${i}`);
      assert.ok(isValidIpv4(`0.0.${i}.0`), `octet ${i}`);
      assert.ok(isValidIpv4(`0.0.0.${i}`), `octet ${i}`);
    }
  });

  it('rejects every out-of-range octet', () => {
    for (const v of ['256.0.0.0', '999.0.0.0', '300.300.300.300', '1.2.3.256']) {
      assert.strictEqual(isValidIpv4(v), false, v);
    }
  });

  it('rejects every shape that is not exactly 4 dotted octets', () => {
    for (const v of ['1', '1.2', '1.2.3', '1.2.3.4.5', '..', '1...4', '01.02.03.4 ',
                     ' 1.2.3.4', '1.2.3.4 ', '1.2.3.4\n']) {
      assert.strictEqual(isValidIpv4(v), false, JSON.stringify(v));
    }
  });
});

// ---------------------------------------------------------------------------
// 2.6 resolvePlatform — never throws, always returns valid platform
// ---------------------------------------------------------------------------

describe('STRESS 2.6 — resolvePlatform is total', () => {
  it('returns a valid platform for any input we can throw at it', () => {
    const inputs = [
      undefined, null, {}, [], 0, false, '',
      { platform: 'android' }, { platform: 'ios' },
      { platform: 'ANDROID' }, { platform: 'IOS' },
      { platform: ' android ' }, { platform: 0 },
      { platform: null }, { platform: undefined }, { platform: ['ios'] },
      { platform: 'windows' }, { platform: 'macos' },
    ];
    for (const inp of inputs) {
      const got = resolvePlatform(inp);
      assert.ok(['android', 'ios'].includes(got),
        `resolvePlatform(${JSON.stringify(inp)}) -> ${got}`);
    }
  });
});
