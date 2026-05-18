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
import { isConnectionError, InvalidArgument } from './src/errors.js';

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
  platform: {
    type: 'string',
    enum: ['android', 'ios', 'auto'],
    description: 'Target platform. "auto" probes ADB then usbmuxd and caches the choice. Default: android.',
  },
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
        maxDepth: { type: 'number', description: 'Truncate the tree below this depth. Pruned subtrees collapse to "…".' },
        maxNodes: { type: 'number', description: 'Cap the total kept-node count after pruning (DFS order).' },
        ...PLATFORM_PROP,
      },
    },
  }),
  withPlatformTag({
    name: 'tap',
    description: 'Tap an element. Pass `ref` from snapshot OR `selector` {text|contentDesc} to re-snapshot and match. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot (e.g. "8"). Mutually exclusive with selector.' },
        selector: {
          type: 'object',
          description: 'Substring selector instead of a ref. Triggers a fresh snapshot.',
          properties: {
            text: { type: 'string' },
            contentDesc: { type: 'string' },
          },
        },
        ...PLATFORM_PROP,
      },
    },
  }),
  withPlatformTag({
    name: 'type',
    description: 'Type text into an element. Pass `ref` or `selector`. Taps to focus first; `clear` clears existing content. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot. Mutually exclusive with selector.' },
        selector: {
          type: 'object',
          description: 'Substring selector {text|contentDesc}.',
          properties: { text: { type: 'string' }, contentDesc: { type: 'string' } },
        },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear existing content first (default: false)' },
        ...PLATFORM_PROP,
      },
      required: ['text'],
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
    description: 'Scroll an element. Pass `ref` or `selector`. Direction: up, down, left, right. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref to scroll (e.g. "3").' },
        selector: {
          type: 'object',
          description: 'Substring selector {text|contentDesc}.',
          properties: { text: { type: 'string' }, contentDesc: { type: 'string' } },
        },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        ...PLATFORM_PROP,
      },
      required: ['direction'],
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
    description: 'Long-press an element. Pass `ref` or `selector`. Returns ok.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot.' },
        selector: {
          type: 'object',
          description: 'Substring selector {text|contentDesc}.',
          properties: { text: { type: 'string' }, contentDesc: { type: 'string' } },
        },
        ...PLATFORM_PROP,
      },
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
    name: 'wait_stable',
    description: 'Block until two consecutive snapshots taken `stableMs` apart are identical. Use before acting on UI that may still be animating. Returns the stabilised snapshot text.',
    inputSchema: {
      type: 'object',
      properties: {
        pollMs: { type: 'number', description: 'Poll interval between snapshots (default 250).' },
        stableMs: { type: 'number', description: 'Required idle window before returning (default 500).' },
        timeout: { type: 'number', description: 'Total ms before giving up (default 5000).' },
        ...PLATFORM_PROP,
      },
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
 * `platform: 'auto'` probes ADB (Android) then usbmuxd (iOS) and caches
 * the resolution for the process lifetime. The cache key is the literal
 * "auto" so we only probe once.
 */
let _autoPlatformCache = null;

export async function resolvePlatformAsync(args) {
  const p = (args || {}).platform;
  if (p === 'ios' || p === 'android') return p;
  if (p === 'auto') {
    if (_autoPlatformCache) return _autoPlatformCache;
    // Probe ADB first — fastest when an emulator/USB Android device is up.
    try {
      const adb = await import('./src/adb.js');
      const devs = await adb.listDevices();
      if (devs.length > 0) { _autoPlatformCache = 'android'; return 'android'; }
    } catch { /* adb missing */ }
    // Then usbmuxd (iOS).
    try {
      const usb = await import('./src/usbmux.js');
      const devs = await usb.listDevices();
      if (devs.length > 0) { _autoPlatformCache = 'ios'; return 'ios'; }
    } catch { /* usbmuxd missing */ }
    // Nothing connected — fall back to Android default so getPage produces
    // a meaningful "No ADB devices found" error rather than a silent miss.
    return 'android';
  }
  return 'android';
}

/**
 * Synchronous resolver used by the retry tiers (which can't await inside
 * the existing call shape without a wider refactor). Honours an explicit
 * 'ios'/'android'; for 'auto' returns the cached result if one exists,
 * otherwise 'android'.
 */
export function resolvePlatform(args) {
  const p = (args || {}).platform;
  if (p === 'ios' || p === 'android') return p;
  if (p === 'auto' && _autoPlatformCache) return _autoPlatformCache;
  return 'android';
}

/** Test hook — reset the auto-detect cache. */
export function _resetAutoPlatformCache() { _autoPlatformCache = null; }

async function handleToolCall(name, args) {
  const platform = await resolvePlatformAsync(args);

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
      const snapOpts = {};
      if (args.maxDepth != null) snapOpts.maxDepth = args.maxDepth;
      if (args.maxNodes != null) snapOpts.maxNodes = args.maxNodes;
      let text = await page.snapshot(snapOpts);
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
      const target = args.ref ?? args.selector;
      if (target == null) throw new InvalidArgument('tap requires `ref` or `selector`');
      const page = await getPage(platform);
      await page.tap(target);
      return 'ok';
    }
    case 'type': {
      const target = args.ref ?? args.selector;
      if (target == null) throw new InvalidArgument('type requires `ref` or `selector`');
      const page = await getPage(platform);
      await page.type(target, args.text, { clear: args.clear });
      return 'ok';
    }
    case 'press': {
      const page = await getPage(platform);
      await page.press(args.key);
      return 'ok';
    }
    case 'scroll': {
      const target = args.ref ?? args.selector;
      if (target == null) throw new InvalidArgument('scroll requires `ref` or `selector`');
      const page = await getPage(platform);
      await page.scroll(target, args.direction);
      return 'ok';
    }
    case 'swipe': {
      const page = await getPage(platform);
      await page.swipe(args.x1, args.y1, args.x2, args.y2, args.duration);
      return 'ok';
    }
    case 'long_press': {
      const target = args.ref ?? args.selector;
      if (target == null) throw new InvalidArgument('long_press requires `ref` or `selector`');
      const page = await getPage(platform);
      await page.longPress(target);
      return 'ok';
    }
    case 'wait_stable': {
      const page = await getPage(platform);
      const snap = await page.waitForStable({
        pollMs: args.pollMs,
        stableMs: args.stableMs,
        timeout: args.timeout,
      });
      const limit = args.maxChars ?? MAX_CHARS_DEFAULT;
      if (snap.length > limit) {
        const file = saveSnapshot(snap);
        return `Stabilised snapshot (${snap.length} chars) saved to ${file}`;
      }
      return snap;
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
        const isConnErr = isConnectionError(err);
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
      const isConnErr = isConnectionError(err);
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
        content: [{ type: 'text', text: `Error: ${err?.message || String(err)}${hint}` }],
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
