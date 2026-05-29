/**
 * daemon.js -- Background HTTP server holding a connect() session.
 *
 * startDaemon()  — spawn a detached child process running the daemon
 * runDaemon()    — the actual HTTP server (called via --daemon-internal)
 *
 * Supports both Android and iOS via --platform flag.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SESSION_FILE = 'session.json';

/**
 * Parse a timeout argument coming over the HTTP wire (always a string or
 * undefined in JSON). Returns `undefined` when the caller omitted it so
 * downstream defaults apply; throws on malformed input rather than silently
 * coercing `""` / `"abc"` to 0 / NaN (which previously made wait-* commands
 * "succeed" instantly with a misleading timeout error).
 *
 * @param {unknown} v
 * @returns {number|undefined}
 */
/**
 * Atomically write a file by writing to a sibling `<path>.tmp` and then
 * renaming over the target. `rename(2)` is atomic on the same filesystem,
 * so concurrent readers (the parent process polling session.json) either
 * see the previous file or the fully-written new one — never a half.
 *
 * @param {string} path
 * @param {string|Buffer} contents
 */
export function atomicWriteFileSync(path, contents) {
  const tmp = `${path}.tmp`;
  // 0600: session.json carries the daemon's loopback port. The daemon's
  // /command endpoint is unauthenticated, so a world-readable port lets any
  // other local user drive the connected device. Owner-only read closes the
  // cross-user path (same-uid processes can already read our files regardless).
  writeFileSync(tmp, contents, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Push a line into a bounded ring buffer. When `arr.length` would exceed
 * `max`, drop the oldest `trim` entries in one `splice()` so we amortise
 * the shift cost across `trim` pushes instead of paying O(n) per push.
 *
 * @template T
 * @param {T[]} arr
 * @param {T} line
 * @param {number} max
 * @param {number} trim
 */
export function pushBounded(arr, line, max, trim) {
  arr.push(line);
  if (arr.length > max) {
    arr.splice(0, arr.length - max + trim);
  }
}

export function parseTimeout(v) {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return undefined;
    // Reject anything that isn't a plain decimal — Number() would happily
    // coerce '5s', '   42', etc. to numbers and lose intent.
    if (!/^\d+(\.\d+)?$/.test(t)) {
      throw new Error(`Invalid timeout: ${JSON.stringify(v)} (expected non-negative number in milliseconds)`);
    }
    return Number(t);
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new Error(`Invalid timeout: ${JSON.stringify(v)} (expected non-negative number in milliseconds)`);
  }
  return v;
}

/**
 * Spawn a detached child process that runs the daemon.
 * Parent polls for session.json, then exits.
 */
export async function startDaemon(opts, outputDir) {
  const absDir = resolve(outputDir);
  mkdirSync(absDir, { recursive: true });

  // Clean stale session
  const sessionPath = join(absDir, SESSION_FILE);
  if (existsSync(sessionPath)) unlinkSync(sessionPath);

  // Build child args
  const args = [join(import.meta.dirname, '..', 'cli.js'), '--daemon-internal'];
  args.push('--output-dir', absDir);
  if (opts.device) args.push('--device', opts.device);
  if (opts.platform) args.push('--platform', opts.platform);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  // Poll for session.json (50ms interval, 15s timeout)
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (existsSync(sessionPath)) {
      try {
        const data = JSON.parse(readFileSync(sessionPath, 'utf8'));
        if (data.port && data.pid) return data;
      } catch { /* partial write, retry */ }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Daemon failed to start within 15s');
}

/**
 * Run the daemon HTTP server. Called by cli.js --daemon-internal.
 * Holds a connect() session and serves commands over HTTP.
 */
export async function runDaemon(opts, outputDir) {
  const absDir = resolve(outputDir);
  mkdirSync(absDir, { recursive: true });

  const platform = opts.platform || 'android';

  // Connect to device — dynamic import based on platform
  const connectFn = platform === 'ios'
    ? (await import('./ios.js')).connect
    : (await import('./index.js')).connect;

  const page = await connectFn({
    device: opts.device,
  });

  // Logcat capture (Android only) — bounded ring buffer to keep memory
  // predictable on long-lived daemons. Once we cross LOGCAT_MAX, drop the
  // oldest LOGCAT_TRIM lines in one shift (amortised O(1)) instead of
  // shifting on every push (O(n²)).
  const LOGCAT_MAX = 50_000;
  const LOGCAT_TRIM = 1_000;
  const logcatEntries = [];
  let logcatChild = null;
  if (platform === 'android') {
    try {
      const logcatArgs = ['-s', page.serial, 'logcat', '-v', 'time'];
      logcatChild = spawn('adb', logcatArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
      let partial = '';
      logcatChild.stdout.on('data', (chunk) => {
        partial += chunk.toString();
        const lines = partial.split('\n');
        partial = lines.pop() ?? ''; // keep incomplete last line (split always yields ≥1)
        for (const line of lines) {
          if (line.trim()) pushBounded(logcatEntries, line, LOGCAT_MAX, LOGCAT_TRIM);
        }
      });
      logcatChild.on('error', (e) => {
        process.stderr.write(`[baremobile] logcat capture disabled: ${e.message}\n`);
      });
    } catch (e) {
      process.stderr.write(`[baremobile] logcat capture disabled: ${e.message}\n`);
    }
  }

  // Android-only handler guard
  const androidOnly = (name) => () => ({ ok: false, error: `${name} is not available on iOS` });

  // Command handlers
  const handlers = {
    async snapshot() {
      const text = await page.snapshot();
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(absDir, `screen-${ts}.yml`);
      writeFileSync(file, text);
      return { ok: true, file };
    },

    async screenshot() {
      const buf = await page.screenshot();
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(absDir, `screenshot-${ts}.png`);
      writeFileSync(file, buf);
      return { ok: true, file };
    },

    async tap({ ref }) {
      await page.tap(String(ref));
      return { ok: true };
    },

    async type({ ref, text, clear }) {
      await page.type(String(ref), text, clear ? { clear: true } : undefined);
      return { ok: true };
    },

    async press({ key }) {
      await page.press(key);
      return { ok: true };
    },

    async scroll({ ref, direction }) {
      await page.scroll(String(ref), direction);
      return { ok: true };
    },

    async swipe({ x1, y1, x2, y2, duration }) {
      await page.swipe(x1, y1, x2, y2, duration);
      return { ok: true };
    },

    async 'long-press'({ ref }) {
      await page.longPress(String(ref));
      return { ok: true };
    },

    async launch({ pkg }) {
      await page.launch(pkg);
      return { ok: true };
    },

    activate: platform === 'android'
      ? () => ({ ok: false, error: 'activate is iOS-only (Android apps relaunch via launch)' })
      : async ({ bundleId }) => {
        await page.activate(bundleId);
        return { ok: true };
      },

    async back() {
      await page.back();
      return { ok: true };
    },

    async home() {
      await page.home();
      return { ok: true };
    },

    async 'tap-xy'({ x, y }) {
      await page.tapXY(Number(x), Number(y));
      return { ok: true };
    },

    // Android-only handlers — return error on iOS
    'tap-grid': platform === 'ios' ? androidOnly('tap-grid') : async ({ cell }) => {
      await page.tapGrid(cell);
      return { ok: true };
    },

    intent: platform === 'ios' ? androidOnly('intent') : async ({ action, extras }) => {
      await page.intent(action, extras || {});
      return { ok: true };
    },

    async 'wait-text'({ text, timeout }) {
      const t = parseTimeout(timeout);
      const snap = await page.waitForText(text, t);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(absDir, `screen-${ts}.yml`);
      writeFileSync(file, snap);
      return { ok: true, file };
    },

    async 'wait-state'({ ref, state, timeout }) {
      const t = parseTimeout(timeout);
      const snap = await page.waitForState(ref, state, t);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(absDir, `screen-${ts}.yml`);
      writeFileSync(file, snap);
      return { ok: true, file };
    },

    grid: platform === 'ios' ? androidOnly('grid') : async () => {
      const g = await page.grid();
      return { ok: true, value: g };
    },

    logcat: platform === 'ios' ? androidOnly('logcat') : async (/** @type {{filter?: string, clear?: boolean}} */ { filter, clear } = {}) => {
      let entries = logcatEntries;
      if (filter) {
        entries = entries.filter(line => line.includes(filter));
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(absDir, `logcat-${ts}.json`);
      writeFileSync(file, JSON.stringify(entries, null, 2));
      const count = entries.length;
      if (clear) {
        logcatEntries.length = 0;
      }
      return { ok: true, file, count };
    },

    async close() {
      if (logcatChild) { try { logcatChild.kill(); } catch { /* already dead */ } }
      page.close();
      const sessionPath = join(absDir, SESSION_FILE);
      if (existsSync(sessionPath)) unlinkSync(sessionPath);
      return { ok: true };
    },

    async status() {
      return { ok: true, pid: process.pid, uptime: process.uptime() };
    },
  };

  // Start HTTP server on random port
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/command') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      return;
    }

    const { command, args } = parsed;
    const handler = handlers[command];
    if (!handler) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `Unknown command: ${command}` }));
      return;
    }

    try {
      const result = await handler(args || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // For the `close` command we must let the response fully flush before
      // exiting — calling process.exit() on the next line races the socket
      // teardown and the client sees ECONNRESET instead of `{ok: true}`.
      if (command === 'close') {
        res.end(JSON.stringify(result), () => {
          server.close(() => process.exit(0));
        });
      } else {
        res.end(JSON.stringify(result));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });

  const addr = server.address();
  // A listening TCP server always yields an AddressInfo object here.
  const port = (addr && typeof addr === 'object') ? addr.port : 0;

  // Write session.json so parent/clients can find us. Use atomic write so
  // the parent's poll loop never reads a partially-written record.
  const sessionPath = join(absDir, SESSION_FILE);
  atomicWriteFileSync(sessionPath, JSON.stringify({
    port,
    pid: process.pid,
    platform,
    startedAt: new Date().toISOString(),
  }));

  // Handle SIGTERM gracefully
  process.on('SIGTERM', () => {
    if (logcatChild) { try { logcatChild.kill(); } catch { /* already dead */ } }
    page.close();
    if (existsSync(sessionPath)) unlinkSync(sessionPath);
    server.close();
    process.exit(0);
  });
}
