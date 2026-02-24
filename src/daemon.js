/**
 * daemon.js -- Background HTTP server holding a connect() session.
 *
 * startDaemon()  — spawn a detached child process running the daemon
 * runDaemon()    — the actual HTTP server (called via --daemon-internal)
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connect } from './index.js';

const SESSION_FILE = 'session.json';

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

  // Connect to device
  const page = await connect({
    device: opts.device,
  });

  // Logcat capture
  const logcatEntries = [];
  let logcatChild = null;
  try {
    const logcatArgs = ['-s', page.serial, 'logcat', '-v', 'time'];
    logcatChild = spawn('adb', logcatArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
    let partial = '';
    logcatChild.stdout.on('data', (chunk) => {
      partial += chunk.toString();
      const lines = partial.split('\n');
      partial = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        if (line.trim()) logcatEntries.push(line);
      }
    });
    logcatChild.on('error', () => { /* adb not found or device gone — ignore */ });
  } catch { /* logcat optional — don't block daemon */ }

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

    async 'tap-grid'({ cell }) {
      await page.tapGrid(cell);
      return { ok: true };
    },

    async intent({ action, extras }) {
      await page.intent(action, extras || {});
      return { ok: true };
    },

    async 'wait-text'({ text, timeout }) {
      const snap = await page.waitForText(text, timeout ? Number(timeout) : undefined);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(absDir, `screen-${ts}.yml`);
      writeFileSync(file, snap);
      return { ok: true, file };
    },

    async 'wait-state'({ ref, state, timeout }) {
      const snap = await page.waitForState(ref, state, timeout ? Number(timeout) : undefined);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(absDir, `screen-${ts}.yml`);
      writeFileSync(file, snap);
      return { ok: true, file };
    },

    async grid() {
      const g = await page.grid();
      return { ok: true, value: g };
    },

    async logcat({ filter, clear } = {}) {
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
      res.end(JSON.stringify(result));

      // Exit after close command
      if (command === 'close') {
        server.close();
        process.exit(0);
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = server.address().port;

  // Write session.json so parent/clients can find us
  const sessionPath = join(absDir, SESSION_FILE);
  writeFileSync(sessionPath, JSON.stringify({
    port,
    pid: process.pid,
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
