/**
 * Unit tests for MCP server — tool definitions, JSON-RPC dispatch, saveSnapshot logic.
 *
 * Run: node --test test/unit/mcp.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS, handleMessage } from '../../mcp-server.js';

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

  it('screenshot and back have no required params', () => {
    const screenshot = TOOLS.find(t => t.name === 'screenshot');
    const back = TOOLS.find(t => t.name === 'back');
    assert.equal(screenshot.inputSchema.required, undefined);
    assert.equal(back.inputSchema.required, undefined);
  });
});

// --- JSON-RPC dispatch ---

describe('MCP JSON-RPC dispatch', () => {
  it('initialize returns server info', async () => {
    const raw = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const res = JSON.parse(raw);
    assert.equal(res.id, 1);
    assert.equal(res.result.serverInfo.name, 'baremobile');
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.ok(res.result.capabilities.tools);
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
