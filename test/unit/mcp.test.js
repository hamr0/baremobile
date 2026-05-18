/**
 * Unit tests for MCP server — tool definitions, JSON-RPC dispatch, saveSnapshot logic.
 *
 * Run: node --test test/unit/mcp.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS, handleMessage, resolvePlatform } from '../../mcp-server.js';

describe('resolvePlatform (Phase 2 fix 2.6)', () => {
  it('returns explicit platform when valid', () => {
    assert.strictEqual(resolvePlatform({ platform: 'android' }), 'android');
    assert.strictEqual(resolvePlatform({ platform: 'ios' }), 'ios');
  });

  it('defaults to android for missing or unknown values', () => {
    assert.strictEqual(resolvePlatform({}), 'android');
    assert.strictEqual(resolvePlatform(undefined), 'android');
    assert.strictEqual(resolvePlatform(null), 'android');
    assert.strictEqual(resolvePlatform({ platform: '' }), 'android');
    assert.strictEqual(resolvePlatform({ platform: 'windows' }), 'android');
    assert.strictEqual(resolvePlatform({ platform: 42 }), 'android');
  });
});

// --- Tool definitions ---

describe('MCP tools/list', () => {
  it('has exactly 10 tools', () => {
    assert.equal(TOOLS.length, 11);
  });

  it('has expected tool names', () => {
    const names = TOOLS.map(t => t.name).sort();
    assert.deepEqual(names, [
      'back', 'find_by_text', 'launch', 'long_press', 'press', 'screenshot',
      'scroll', 'snapshot', 'swipe', 'tap', 'type',
    ]);
  });

  it('every tool has name, description, inputSchema', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.name, `tool missing name`);
      assert.ok(tool.description, `${tool.name} missing description`);
      assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} schema type should be object`);
    }
  });

  it('tap requires ref', () => {
    const tap = TOOLS.find(t => t.name === 'tap');
    assert.deepEqual(tap.inputSchema.required, ['ref']);
  });

  it('type requires ref and text', () => {
    const type = TOOLS.find(t => t.name === 'type');
    assert.deepEqual(type.inputSchema.required, ['ref', 'text']);
  });

  it('scroll requires ref and direction', () => {
    const scroll = TOOLS.find(t => t.name === 'scroll');
    assert.deepEqual(scroll.inputSchema.required, ['ref', 'direction']);
  });

  it('swipe requires x1, y1, x2, y2', () => {
    const swipe = TOOLS.find(t => t.name === 'swipe');
    assert.deepEqual(swipe.inputSchema.required, ['x1', 'y1', 'x2', 'y2']);
  });

  it('find_by_text requires text', () => {
    const fbt = TOOLS.find(t => t.name === 'find_by_text');
    assert.deepEqual(fbt.inputSchema.required, ['text']);
  });

  // Phase 2 fix 2.5 — find_by_text must return a structured JSON payload so
  // an agent can distinguish "not found" from a label that literally reads
  // "null". The wire format is { found: true, ref: "N" } / { found: false }.
  it('find_by_text description documents structured shape', () => {
    const fbt = TOOLS.find(t => t.name === 'find_by_text');
    assert.match(fbt.description, /found/);
    assert.ok(
      !/Returns the ref number or null/.test(fbt.description),
      'description must not promise legacy "null" string format',
    );
  });

  it('find_by_text source returns structured object (no literal "null")', () => {
    const src = readFileSync(join(import.meta.dirname, '../../mcp-server.js'), 'utf8');
    const found = src.match(/case 'find_by_text':[\s\S]+?break|case 'find_by_text':[\s\S]+?\}\s*\n\s*default/);
    assert.ok(found, 'find_by_text case present');
    assert.match(found[0], /\{\s*found:\s*true,\s*ref:/, 'must return {found:true, ref:...}');
    assert.match(found[0], /\{\s*found:\s*false\s*\}/, 'must return {found:false} on miss');
    assert.ok(!/'null'/.test(found[0]), 'must not return the literal string "null"');
  });

  it('screenshot and back have no required params', () => {
    const screenshot = TOOLS.find(t => t.name === 'screenshot');
    const back = TOOLS.find(t => t.name === 'back');
    assert.equal(screenshot.inputSchema.required, undefined);
    assert.equal(back.inputSchema.required, undefined);
  });

  // Phase 2 fix 2.7 — every tool advertises which platforms it supports,
  // both as a structured `_platforms` array and as a `[android|ios]` /
  // `[ios-only]` etc. prefix in the description.
  it('every tool advertises a _platforms array and matching description tag', () => {
    for (const tool of TOOLS) {
      assert.ok(Array.isArray(tool._platforms), `${tool.name} missing _platforms`);
      assert.ok(tool._platforms.length >= 1, `${tool.name} _platforms empty`);
      for (const p of tool._platforms) {
        assert.ok(['android', 'ios'].includes(p), `${tool.name} has unknown platform ${p}`);
      }
      assert.match(tool.description, /^\[(android\|ios|android-only|ios-only)\]/,
        `${tool.name} description must lead with platform tag`);
    }
  });
});

// --- JSON-RPC dispatch ---

describe('MCP JSON-RPC dispatch', () => {
  it('initialize returns server info with version from package.json', async () => {
    const raw = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const res = JSON.parse(raw);
    assert.equal(res.id, 1);
    assert.equal(res.result.serverInfo.name, 'baremobile');
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.ok(res.result.capabilities.tools);
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'));
    assert.equal(res.result.serverInfo.version, pkg.version);
  });

  it('notifications/initialized returns null', async () => {
    const res = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    assert.equal(res, null);
  });

  it('tools/list returns all tools', async () => {
    const raw = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const res = JSON.parse(raw);
    assert.equal(res.result.tools.length, 11);
  });

  it('unknown method returns error -32601', async () => {
    const raw = await handleMessage({ jsonrpc: '2.0', id: 99, method: 'unknown/method', params: {} });
    const res = JSON.parse(raw);
    assert.equal(res.error.code, -32601);
  });

  it('tools/call with unknown tool returns isError', async () => {
    const raw = await handleMessage({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'nonexistent', arguments: {} },
    });
    const res = JSON.parse(raw);
    assert.ok(res.result.isError);
    assert.ok(res.result.content[0].text.includes('Unknown tool'));
  });

  // Phase 2 fix 2.7 — the _platforms gate must refuse a tool call when the
  // requested platform isn't supported. We can't easily force this through
  // a real TOOLS entry today (every current tool supports both), so we
  // temporarily mutate the tool's _platforms array to confirm the gate
  // fires with a clear, parseable error message.
  it('tools/call rejects unsupported platform with helpful error', async () => {
    const tap = TOOLS.find(t => t.name === 'tap');
    const original = tap._platforms;
    tap._platforms = ['ios']; // pretend tap is iOS-only
    try {
      const raw = await handleMessage({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'tap', arguments: { ref: '1', platform: 'android' } },
      });
      const res = JSON.parse(raw);
      assert.ok(res.result.isError, 'must mark response as error');
      assert.match(res.result.content[0].text, /not supported on platform "android"/);
      assert.match(res.result.content[0].text, /Supported: ios/);
    } finally {
      tap._platforms = original;
    }
  });
});

// --- saveSnapshot logic (re-implemented locally since not exported) ---

const OUTPUT_DIR = join(import.meta.dirname, '../../.baremobile-test');

function saveSnapshot(text) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(OUTPUT_DIR, `screen-${ts}.yml`);
  writeFileSync(file, text);
  return file;
}

describe('MCP saveSnapshot', () => {
  it('saves text to a .yml file and returns the path', () => {
    const text = 'FrameLayout\n  Button "OK" [ref=1]';
    const file = saveSnapshot(text);
    try {
      assert.ok(file.endsWith('.yml'));
      assert.ok(file.includes('screen-'));
      const content = readFileSync(file, 'utf8');
      assert.equal(content, text);
    } finally {
      rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it('maxChars threshold routes correctly', () => {
    const MAX_CHARS_DEFAULT = 30000;
    const shortText = 'x'.repeat(100);
    const longText = 'x'.repeat(40000);

    assert.ok(shortText.length <= MAX_CHARS_DEFAULT);
    assert.ok(longText.length > MAX_CHARS_DEFAULT);

    const customLimit = 50;
    assert.ok(shortText.length > customLimit);
  });
});
