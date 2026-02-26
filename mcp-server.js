#!/usr/bin/env node
/**
 * mcp-server.js — MCP server for baremobile.
 *
 * Raw JSON-RPC 2.0 over stdio. No SDK dependency.
 * 10 tools: snapshot, tap, type, press, scroll, swipe, long_press, launch, screenshot, back.
 *
 * Dual-platform: Android (default) and iOS. Each platform gets its own
 * lazy-created page. Pass platform: "ios" to target iPhone.
 * Action tools return 'ok' — agent calls snapshot explicitly to observe.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIosCert } from './src/ios-cert.js';

const MAX_CHARS_DEFAULT = 30000;
const OUTPUT_DIR = join(process.cwd(), '.baremobile');

function saveSnapshot(text) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(OUTPUT_DIR, `screen-${ts}.yml`);
  writeFileSync(file, text);
  return file;
}

let _pages = { android: null, ios: null };
let _iosCertWarning = null;

async function getPage(platform = 'android') {
  if (!_pages[platform]) {
    if (platform === 'ios') {
      _iosCertWarning = checkIosCert();
      const mod = await import('./src/ios.js');
      _pages[platform] = await mod.connect();
    } else {
      const mod = await import('./src/index.js');
      _pages[platform] = await mod.connect();
    }
  }
  return _pages[platform];
}

const PLATFORM_PROP = {
  platform: { type: 'string', enum: ['android', 'ios'], description: 'Target platform (default: android)' },
};

const TOOLS = [
  {
    name: 'snapshot',
    description: 'Get the current screen accessibility snapshot. Returns a YAML-like tree with [ref=N] markers on interactive elements.',
    inputSchema: {
      type: 'object',
      properties: {
        maxChars: { type: 'number', description: 'Max chars to return inline. Larger snapshots are saved to .baremobile/ and a file path is returned instead. Default: 30000.' },
        ...PLATFORM_PROP,
      },
    },
  },
  {
    name: 'tap',
    description: 'Tap an element by its ref from the snapshot. Returns ok — call snapshot to observe.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot (e.g. "8")' },
        ...PLATFORM_PROP,
      },
      required: ['ref'],
    },
  },
  {
    name: 'type',
    description: 'Type text into an element by its ref. Taps to focus first (skips if already focused). Returns ok — call snapshot to observe.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear existing content first (default: false)' },
        ...PLATFORM_PROP,
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'press',
    description: 'Press a key: home, back, enter, tab, delete, volume_up, volume_down, power, etc. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (e.g. "home", "back", "enter")' },
        ...PLATFORM_PROP,
      },
      required: ['key'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll an element or the screen. Direction: up, down, left, right. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref to scroll (e.g. "3")' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        ...PLATFORM_PROP,
      },
      required: ['ref', 'direction'],
    },
  },
  {
    name: 'swipe',
    description: 'Swipe between two screen coordinates. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number', description: 'Start X coordinate' },
        y1: { type: 'number', description: 'Start Y coordinate' },
        x2: { type: 'number', description: 'End X coordinate' },
        y2: { type: 'number', description: 'End Y coordinate' },
        duration: { type: 'number', description: 'Swipe duration in ms (default: 300)' },
        ...PLATFORM_PROP,
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'long_press',
    description: 'Long-press an element by its ref from the snapshot. Returns ok — call snapshot to observe.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot' },
        ...PLATFORM_PROP,
      },
      required: ['ref'],
    },
  },
  {
    name: 'launch',
    description: 'Launch an app by identifier. Returns ok — call snapshot to observe.',
    inputSchema: {
      type: 'object',
      properties: {
        pkg: { type: 'string', description: 'App identifier (e.g. "com.android.settings" or "com.apple.Preferences")' },
        ...PLATFORM_PROP,
      },
      required: ['pkg'],
    },
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot. Returns base64-encoded PNG image.',
    inputSchema: {
      type: 'object',
      properties: { ...PLATFORM_PROP },
    },
  },
  {
    name: 'back',
    description: 'Navigate back. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: { ...PLATFORM_PROP },
    },
  },
];

async function handleToolCall(name, args) {
  const platform = args.platform || 'android';

  switch (name) {
    case 'snapshot': {
      const page = await getPage(platform);
      let text = await page.snapshot();
      // Prepend cert warning on first iOS snapshot
      if (platform === 'ios' && _iosCertWarning) {
        text = `⚠️ ${_iosCertWarning}\n\n${text}`;
        _iosCertWarning = null;
      }
      const limit = args.maxChars ?? MAX_CHARS_DEFAULT;
      if (text.length > limit) {
        const file = saveSnapshot(text);
        return `Snapshot (${text.length} chars) saved to ${file}`;
      }
      return text;
    }
    case 'tap': {
      const page = await getPage(platform);
      await page.tap(args.ref);
      return 'ok';
    }
    case 'type': {
      const page = await getPage(platform);
      await page.type(args.ref, args.text, { clear: args.clear });
      return 'ok';
    }
    case 'press': {
      const page = await getPage(platform);
      await page.press(args.key);
      return 'ok';
    }
    case 'scroll': {
      const page = await getPage(platform);
      await page.scroll(args.ref, args.direction);
      return 'ok';
    }
    case 'swipe': {
      const page = await getPage(platform);
      await page.swipe(args.x1, args.y1, args.x2, args.y2, args.duration);
      return 'ok';
    }
    case 'long_press': {
      const page = await getPage(platform);
      await page.longPress(args.ref);
      return 'ok';
    }
    case 'launch': {
      const page = await getPage(platform);
      await page.launch(args.pkg);
      return 'ok';
    }
    case 'screenshot': {
      const page = await getPage(platform);
      const buf = await page.screenshot();
      const b64 = buf.toString('base64');
      return { _image: b64 };
    }
    case 'back': {
      const page = await getPage(platform);
      await page.back();
      return 'ok';
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function jsonrpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return jsonrpcResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'baremobile', version: '0.7.0' },
    });
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'tools/list') {
    return jsonrpcResponse(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const result = await handleToolCall(name, args || {});
      // Screenshot returns image content type
      if (result && result._image) {
        return jsonrpcResponse(id, {
          content: [{ type: 'image', data: result._image, mimeType: 'image/png' }],
        });
      }
      return jsonrpcResponse(id, {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
      });
    } catch (err) {
      return jsonrpcResponse(id, {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      });
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`);
}

// --- Stdio transport (only when run directly, not imported) ---

const __filename = fileURLToPath(import.meta.url);
const isMain = resolve(process.argv[1]) === __filename;

if (isMain) {
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        const response = await handleMessage(msg);
        if (response) {
          process.stdout.write(response + '\n');
        }
      } catch (err) {
        process.stdout.write(jsonrpcError(null, -32700, `Parse error: ${err.message}`) + '\n');
      }
    }
  });

  process.on('SIGINT', async () => {
    for (const p of Object.values(_pages)) if (p) p.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    for (const p of Object.values(_pages)) if (p) p.close();
    process.exit(0);
  });
}

// Export for testing
export { TOOLS, handleMessage, handleToolCall };
