#!/usr/bin/env node
/**
 * mcp-server.js — MCP server for baremobile.
 *
 * Raw JSON-RPC 2.0 over stdio. No SDK dependency.
 * Tool definitions live in the TOOLS array below — count drifts with the
 * code so don't repeat it in prose. Each tool's `_platforms` array gates
 * cross-platform calls; descriptions lead with `[android|ios]` etc.
 *
 * Dual-platform: Android (default) and iOS. Each platform gets its own
 * lazy-created page. Pass platform: "ios" to target iPhone.
 * Action tools return 'ok' — agent calls snapshot explicitly to observe.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIosCert } from './src/ios-cert.js';

const __dirname = import.meta.dirname;
const PKG_VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version;

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

// `_platforms` is a non-standard advisory field consumed by the helper
// below and by tests. MCP-spec clients ignore unknown fields, so adding it
// is safe and lets us surface platform support to agents that read the
// description text. Keep this in sync with the underlying page-object API
// — anything listed here must work uniformly on the named platforms.
const BOTH = ['android', 'ios'];

function withPlatformTag(tool, platforms = BOTH) {
  const tag = platforms.length === BOTH.length ? '[android|ios]' : `[${platforms.join('|')}-only]`;
  return { ...tool, _platforms: platforms, description: `${tag} ${tool.description}` };
}

const TOOLS = [
  withPlatformTag({
    name: 'snapshot',
    description: 'Get the current screen accessibility snapshot. Returns a YAML-like tree with [ref=N] markers on interactive elements.',
    inputSchema: {
      type: 'object',
      properties: {
        maxChars: { type: 'number', description: 'Max chars to return inline. Larger snapshots are saved to .baremobile/ and a file path is returned instead. Default: 30000.' },
        ...PLATFORM_PROP,
      },
    },
  }),
  withPlatformTag({
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
  }),
  withPlatformTag({
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
  }),
  withPlatformTag({
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
  }),
  withPlatformTag({
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
  }),
  withPlatformTag({
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
  }),
  withPlatformTag({
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
  }),
  withPlatformTag({
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
  }),
  withPlatformTag({
    name: 'activate',
    description: 'Bring an already-running app to the foreground without relaunching it. Use this on iOS when launch would tear down app state. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string', description: 'iOS bundle identifier (e.g. "com.apple.Preferences")' },
        ...PLATFORM_PROP,
      },
      required: ['bundleId'],
    },
  }, ['ios']),
  withPlatformTag({
    name: 'screenshot',
    description: 'Take a screenshot. Returns base64-encoded PNG image.',
    inputSchema: {
      type: 'object',
      properties: { ...PLATFORM_PROP },
    },
  }),
  withPlatformTag({
    name: 'back',
    description: 'Navigate back. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: { ...PLATFORM_PROP },
    },
  }),
  withPlatformTag({
    name: 'find_by_text',
    description: 'Find an interactive element by text match. Returns JSON {"found": true, "ref": "N"} or {"found": false}. Requires a prior snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to search for (substring match)' },
        ...PLATFORM_PROP,
      },
      required: ['text'],
    },
  }),
];

/**
 * Resolve the target platform for a tool call. Centralised so the call
 * site and every retry tier agree on which `_pages[*]` slot to read or
 * clear — drift between them produces "cleared the wrong cache" bugs
 * that are very hard to reproduce.
 *
 * Today the resolution is trivial (explicit arg or Android default), but
 * keeping a single resolver lets Phase 4.4's `platform: 'auto'` plug in
 * here without changing any retry logic.
 */
export function resolvePlatform(args) {
  const p = (args || {}).platform;
  if (p === 'ios' || p === 'android') return p;
  return 'android';
}

async function handleToolCall(name, args) {
  const platform = resolvePlatform(args);

  // Refuse tool calls that target a platform the tool doesn't support.
  // Today every tool supports both; this gate exists so Phase 3.1's iOS-only
  // `activate` (and any future android-only tools) fail with a clear message
  // instead of a cryptic "method not on page" error.
  const tool = TOOLS.find(t => t.name === name);
  if (tool && Array.isArray(tool._platforms) && !tool._platforms.includes(platform)) {
    throw new Error(
      `Tool "${name}" is not supported on platform "${platform}". Supported: ${tool._platforms.join(', ')}.`
    );
  }

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
    case 'activate': {
      // Gate above already rejects activate on android, but keep the
      // call site simple — getPage(platform) is whatever resolved.
      const page = await getPage(platform);
      await page.activate(args.bundleId);
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
    case 'find_by_text': {
      const page = await getPage(platform);
      const ref = page.findByText(args.text);
      // Return a structured payload so the agent doesn't have to disambiguate
      // a "not found" sentinel from a label that happens to be the string
      // "null". The wrapper below JSON.stringifies non-string returns.
      return ref !== null ? { found: true, ref: String(ref) } : { found: false };
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
      serverInfo: { name: 'baremobile', version: PKG_VERSION },
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
      let result;
      try {
        result = await handleToolCall(name, args || {});
      } catch (err) {
        // Auto-reconnect: if WDA/device connection died, clear cache and retry once
        const msg = err?.message || '';
        const isConnErr = err?.code === 'ECONNREFUSED' || err?.code === 'ECONNRESET'
          || err?.code === 'WDA_TIMEOUT'
          || msg.includes('fetch failed') || msg.includes('ECONNREFUSED')
          || msg.includes('ECONNRESET') || msg.includes('UND_ERR');
        const platform = resolvePlatform(args);
        if (isConnErr && _pages[platform]) {
          try { _pages[platform].close(); } catch { /* ignore */ }
          _pages[platform] = null;
          result = await handleToolCall(name, args || {});
        } else {
          throw err;
        }
      }
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
      const msg = err?.message || '';
      const isConnErr = err?.code === 'ECONNREFUSED' || err?.code === 'ECONNRESET'
        || err?.code === 'WDA_TIMEOUT'
        || msg.includes('fetch failed') || msg.includes('ECONNREFUSED');
      const platform = resolvePlatform(args);

      // Tier 2: iOS auto-restart — reconnect failed, try restarting WDA tunnel
      if (isConnErr && platform === 'ios') {
        try {
          const { restartWda } = await import('./src/setup.js');
          await restartWda((m) => process.stderr.write(`[baremobile] ${m}\n`));
          _pages[platform] = null;
          const result = await handleToolCall(name, args || {});
          if (result && result._image) {
            return jsonrpcResponse(id, {
              content: [{ type: 'image', data: result._image, mimeType: 'image/png' }],
            });
          }
          return jsonrpcResponse(id, {
            content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
          });
        } catch (restartErr) {
          return jsonrpcResponse(id, {
            content: [{ type: 'text', text: `WDA tunnel died and auto-restart failed: ${restartErr.message}. Reconnect USB and run \`npx baremobile setup\`.` }],
            isError: true,
          });
        }
      }

      const hint = isConnErr
        ? ' WDA/ADB may be down. Reconnect USB and run `npx baremobile setup`.'
        : '';
      return jsonrpcResponse(id, {
        content: [{ type: 'text', text: `Error: ${msg}${hint}` }],
        isError: true,
      });
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`);
}

// --- Stdio transport ---

export function startStdio() {
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

// Auto-start when run directly (node mcp-server.js). The CLI path
// (`baremobile mcp`) calls startStdio() explicitly — see cli.js.
import { realpathSync } from 'node:fs';
const __filename = fileURLToPath(import.meta.url);
const argv1 = process.argv[1];
if (argv1) {
  try {
    if (realpathSync(resolve(argv1)) === realpathSync(__filename)) startStdio();
  } catch { /* argv1 may not exist on disk */ }
}

// Export for testing
export { TOOLS, handleMessage, handleToolCall };
