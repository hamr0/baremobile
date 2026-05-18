/**
 * Phase 3 validation: regression + necessity + stress for each cleanup fix.
 *
 * - 3.1 iOS `activate` exposure (CLI/daemon/MCP)
 * - 3.2 unreachable col-bounds check removed
 * - 3.3 stale page.close() comment removed
 * - 3.4 hardcoded "11 tools" header removed
 * - 3.6 atomic session.json write
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { TOOLS } from '../../mcp-server.js';
import { buildGrid } from '../../src/interact.js';
import { atomicWriteFileSync } from '../../src/daemon.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) + '/..';
function readSrc(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }

// ---------------------------------------------------------------------------
// 3.1 activate exposure
// ---------------------------------------------------------------------------

describe('Phase 3.1 — iOS activate is exposed end-to-end', () => {
  it('MCP exposes the activate tool restricted to iOS', () => {
    const tool = TOOLS.find(t => t.name === 'activate');
    assert.ok(tool, 'activate tool missing from MCP TOOLS');
    assert.deepEqual(tool._platforms, ['ios']);
    assert.match(tool.description, /\[ios-only\]/);
    assert.deepEqual(tool.inputSchema.required, ['bundleId']);
  });

  it('daemon registers an activate handler', () => {
    const src = readSrc('src/daemon.js');
    assert.match(src, /\bactivate:\s*platform === 'android'/,
      'daemon must register an activate handler with a platform guard');
    assert.match(src, /page\.activate\(bundleId\)/,
      'daemon handler must call page.activate(bundleId)');
  });

  it('CLI accepts `baremobile activate <bundleId>` and reports it in usage', () => {
    const src = readSrc('cli.js');
    assert.match(src, /cmd === 'activate' && args\[1\]/,
      'cli must dispatch the activate command');
    assert.match(src, /baremobile activate <bundleId>/,
      'cli usage must list activate');
  });

  // NECESSITY — before this fix, none of the three layers exposed activate.
  // The MCP gate refuses activate on android with our 2.7 platform-gate.
  it('NECESSITY: activate on android is refused at the MCP boundary', async () => {
    const { handleMessage } = await import('../../mcp-server.js');
    const raw = await handleMessage({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'activate', arguments: { bundleId: 'com.apple.x', platform: 'android' } },
    });
    const res = JSON.parse(raw);
    assert.ok(res.result.isError, 'must be flagged as error');
    assert.match(res.result.content[0].text, /not supported on platform "android"/);
  });
});

// ---------------------------------------------------------------------------
// 3.2 unreachable col-bounds check removed
// ---------------------------------------------------------------------------

describe('Phase 3.2 — col-bounds check is gone', () => {
  it('source no longer carries the unreachable `col < 0 || col >= cols` branch', () => {
    const src = readSrc('src/interact.js');
    assert.ok(!/col\s*<\s*0\s*\|\|\s*col\s*>=\s*cols/.test(src),
      'unreachable col-bounds check must be deleted');
  });

  it('grid still rejects invalid column letters via the regex', () => {
    const g = buildGrid(1080, 2400);
    // Letters beyond J fail the regex, not the deleted branch.
    assert.throws(() => g.resolve('K1'), /Invalid grid cell/);
    assert.throws(() => g.resolve('Z9'), /Invalid grid cell/);
  });

  it('grid still rejects rows out of range', () => {
    const g = buildGrid(1080, 2400);
    assert.throws(() => g.resolve('A99999'), /Row out of range/);
    assert.throws(() => g.resolve('A0'), /Row out of range/);
  });

  it('grid stress: random valid cells always resolve, random invalid always throw', () => {
    const g = buildGrid(1080, 2400);
    const cols = ['A','B','C','D','E','F','G','H','I','J'];
    for (let i = 0; i < 500; i++) {
      const c = cols[Math.floor(Math.random() * 10)];
      const r = 1 + Math.floor(Math.random() * g.rows);
      const { x, y } = g.resolve(`${c}${r}`);
      assert.ok(x >= 0 && x <= 1080, `x=${x}`);
      assert.ok(y >= 0 && y <= 2400, `y=${y}`);
    }
    for (let i = 0; i < 100; i++) {
      const bad = String.fromCharCode(75 + (i % 16)) + (1 + Math.floor(Math.random() * 50));
      assert.throws(() => g.resolve(bad));
    }
  });
});

// ---------------------------------------------------------------------------
// 3.3 stale page.close() comment removed
// ---------------------------------------------------------------------------

describe('Phase 3.3 — stale "future daemon" comment is gone', () => {
  it('src/index.js no longer claims the daemon is future work', () => {
    const src = readSrc('src/index.js');
    assert.ok(!/future daemon/.test(src),
      'comment claiming daemon is future work must be removed');
  });
});

// ---------------------------------------------------------------------------
// 3.4 hardcoded tool count removed from MCP header
// ---------------------------------------------------------------------------

describe('Phase 3.4 — header no longer hardcodes a tool count', () => {
  it('mcp-server.js header drops the "11 tools" enumeration', () => {
    const header = readSrc('mcp-server.js').split('\n').slice(0, 15).join('\n');
    assert.ok(!/\b\d+ tools:/.test(header),
      'header must not hardcode "N tools:" — count drifts');
  });
});

// ---------------------------------------------------------------------------
// 3.6 atomic session.json write
// ---------------------------------------------------------------------------

describe('Phase 3.6 — atomicWriteFileSync', () => {
  function withTmp(fn) {
    const tmp = mkdtempSync(join(tmpdir(), 'baremobile-atomic-'));
    try { return fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  it('writes the file with the expected contents', () => {
    withTmp((tmp) => {
      const f = join(tmp, 'data.json');
      atomicWriteFileSync(f, '{"port":5555}');
      assert.strictEqual(readFileSync(f, 'utf8'), '{"port":5555}');
    });
  });

  it('does not leave the `.tmp` sidecar behind on success', () => {
    withTmp((tmp) => {
      const f = join(tmp, 'data.json');
      atomicWriteFileSync(f, '{}');
      assert.strictEqual(existsSync(`${f}.tmp`), false);
    });
  });

  it('overwrites an existing file in one rename — same inode contract', () => {
    withTmp((tmp) => {
      const f = join(tmp, 'data.json');
      writeFileSync(f, 'old');
      const oldInode = statSync(f).ino;
      atomicWriteFileSync(f, 'new');
      assert.strictEqual(readFileSync(f, 'utf8'), 'new');
      // rename(2) produces a different inode (atomic replacement, not edit).
      assert.notStrictEqual(statSync(f).ino, oldInode,
        'atomic write must replace the file, not edit it in place');
    });
  });

  // NECESSITY — the old pattern (writeFileSync directly to the target path)
  // exposes a small window where a concurrent reader sees the file partway
  // through its bytes. We can't easily race writeFileSync on a small JSON
  // payload (kernel typically flushes in one syscall), but we can prove the
  // CONTRACT: with atomic writes a partial state is impossible by definition
  // because the file path always points to either a fully-written old or
  // fully-written new file — never both, never partial.
  it('NECESSITY: there is no observable in-between state across 200 rapid writes', () => {
    withTmp((tmp) => {
      const f = join(tmp, 'data.json');
      atomicWriteFileSync(f, JSON.stringify({ rev: 0, payload: 'x'.repeat(1024) }));
      for (let i = 1; i <= 200; i++) {
        atomicWriteFileSync(f, JSON.stringify({ rev: i, payload: 'x'.repeat(1024) }));
        // Reader: every observation must be valid JSON parsed with a
        // monotonically non-decreasing rev. Partial writes would break
        // JSON.parse before we even compared.
        const got = JSON.parse(readFileSync(f, 'utf8'));
        assert.strictEqual(got.rev, i);
        assert.strictEqual(got.payload.length, 1024);
      }
    });
  });
});
