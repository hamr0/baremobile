#!/usr/bin/env node
/**
 * cli.js -- baremobile CLI entry point.
 *
 * See `baremobile` (no args) for full command reference.
 */

import { resolve } from 'node:path';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const cmd = args[0];
const jsonMode = hasFlag('--json');

/** Write a single JSON line to stdout. */
function jsonOut(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/** Write an error — JSON line or stderr depending on mode. */
function errOut(msg, exitCode = 1) {
  if (jsonMode) jsonOut({ ok: false, error: msg });
  else process.stderr.write(`Error: ${msg}\n`);
  process.exit(exitCode);
}

// Hidden internal flag: --daemon-internal
if (args.includes('--daemon-internal')) {
  await runDaemonInternal();
} else if (cmd === 'mcp') {
  await import('./mcp-server.js');
} else if (cmd === 'open') {
  await cmdOpen();
} else if (cmd === 'close') {
  await cmdProxy('close');
} else if (cmd === 'status') {
  await cmdStatus();
} else if (cmd === 'snapshot') {
  await cmdProxy('snapshot');
} else if (cmd === 'screenshot') {
  await cmdProxy('screenshot');
} else if (cmd === 'tap' && args[1]) {
  await cmdProxy('tap', { ref: args[1] });
} else if (cmd === 'type' && args[1] && args[2]) {
  await cmdProxy('type', { ref: args[1], text: args.slice(2).filter(a => !a.startsWith('--')).join(' '), clear: hasFlag('--clear') });
} else if (cmd === 'press' && args[1]) {
  await cmdProxy('press', { key: args[1] });
} else if (cmd === 'scroll' && args[1] && args[2]) {
  await cmdProxy('scroll', { ref: args[1], direction: args[2] });
} else if (cmd === 'swipe' && args[1] && args[2] && args[3] && args[4]) {
  await cmdProxy('swipe', { x1: Number(args[1]), y1: Number(args[2]), x2: Number(args[3]), y2: Number(args[4]), duration: parseFlag('--duration') ? Number(parseFlag('--duration')) : undefined });
} else if (cmd === 'long-press' && args[1]) {
  await cmdProxy('long-press', { ref: args[1] });
} else if (cmd === 'launch' && args[1]) {
  await cmdProxy('launch', { pkg: args[1] });
} else if (cmd === 'back') {
  await cmdProxy('back');
} else if (cmd === 'home') {
  await cmdProxy('home');
} else if (cmd === 'tap-xy' && args[1] && args[2]) {
  await cmdProxy('tap-xy', { x: Number(args[1]), y: Number(args[2]) });
} else if (cmd === 'tap-grid' && args[1]) {
  await cmdProxy('tap-grid', { cell: args[1] });
} else if (cmd === 'intent' && args[1]) {
  const extras = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--extra-string' && args[i + 1]) {
      const [k, ...rest] = args[++i].split('=');
      extras[k] = rest.join('=');
    }
  }
  await cmdProxy('intent', { action: args[1], extras });
} else if (cmd === 'wait-text' && args[1]) {
  await cmdProxy('wait-text', { text: args[1], timeout: parseFlag('--timeout') });
} else if (cmd === 'wait-state' && args[1] && args[2]) {
  await cmdProxy('wait-state', { ref: args[1], state: args[2], timeout: parseFlag('--timeout') });
} else if (cmd === 'grid') {
  await cmdProxy('grid');
} else if (cmd === 'logcat') {
  await cmdProxy('logcat', { filter: parseFlag('--filter'), clear: hasFlag('--clear') });
} else {
  printUsage();
}


// --- Command implementations ---

async function cmdOpen() {
  const { startDaemon } = await import('./src/daemon.js');
  const { isAlive } = await import('./src/session-client.js');
  const outputDir = resolve('.baremobile');

  // Check for existing session
  if (await isAlive(outputDir)) {
    errOut('Session already running. Use `baremobile close` first.');
  }

  const opts = {
    device: parseFlag('--device'),
  };

  try {
    const session = await startDaemon(opts, outputDir);
    if (jsonMode) {
      jsonOut({ ok: true, pid: session.pid, port: session.port, outputDir });
    } else {
      process.stdout.write(`Session started (pid ${session.pid}, port ${session.port})\n`);
      process.stdout.write(`Output dir: ${outputDir}\n`);
    }
  } catch (err) {
    errOut(err.message);
  }
}

async function cmdStatus() {
  const { readSession, isAlive } = await import('./src/session-client.js');
  const outputDir = resolve('.baremobile');
  const session = readSession(outputDir);

  if (!session) {
    errOut('No session found.');
  }

  const alive = await isAlive(outputDir);
  if (alive) {
    if (jsonMode) {
      jsonOut({ ok: true, pid: session.pid, port: session.port, startedAt: session.startedAt });
    } else {
      process.stdout.write(`Session running (pid ${session.pid}, port ${session.port}, started ${session.startedAt})\n`);
    }
  } else {
    errOut(`Session stale (pid ${session.pid} not responding). Run \`baremobile close\` to clean up.`);
  }
}

async function cmdProxy(command, cmdArgs) {
  const { sendCommand } = await import('./src/session-client.js');
  const outputDir = resolve('.baremobile');

  try {
    const result = await sendCommand(command, cmdArgs, outputDir);

    if (!result.ok) {
      errOut(result.error);
    }

    if (jsonMode) {
      // Pass through daemon JSON directly
      if (command === 'close') {
        const sessionPath = join(outputDir, 'session.json');
        try { unlinkSync(sessionPath); } catch { /* already gone */ }
      }
      jsonOut(result);
      return;
    }

    // Human-readable output
    if (result.file) {
      process.stdout.write(`${result.file}\n`);
    } else if (result.value !== undefined) {
      process.stdout.write(JSON.stringify(result.value) + '\n');
    } else if (command === 'close') {
      const sessionPath = join(outputDir, 'session.json');
      try { unlinkSync(sessionPath); } catch { /* already gone */ }
      process.stdout.write('Session closed.\n');
    } else {
      process.stdout.write('ok\n');
    }
  } catch (err) {
    if (command === 'close') {
      const sessionPath = join(outputDir, 'session.json');
      try { unlinkSync(sessionPath); } catch { /* already gone */ }
      if (jsonMode) jsonOut({ ok: true });
      else process.stdout.write('Session closed.\n');
    } else {
      errOut(err.message);
    }
  }
}

async function runDaemonInternal() {
  const { runDaemon } = await import('./src/daemon.js');
  const opts = {
    device: parseFlag('--device'),
  };
  const outputDir = parseFlag('--output-dir') || resolve('.baremobile');
  await runDaemon(opts, outputDir);
}


// --- Flag parsing helpers ---

function parseFlag(name) {
  // --name=value or --name value
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(name + '=')) return args[i].slice(name.length + 1);
    if (args[i] === name && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  }
  return undefined;
}

function hasFlag(name) {
  return args.includes(name);
}


// --- Usage ---

function printUsage() {
  process.stdout.write(`baremobile -- ADB-direct Android control for autonomous agents

Session:
  baremobile open [--device=SERIAL]    Start ADB session
  baremobile close                     Close session
  baremobile status                    Check session status

Screen:
  baremobile snapshot                  ARIA snapshot -> .baremobile/screen-*.yml
  baremobile screenshot                Screenshot -> .baremobile/screenshot-*.png
  baremobile grid                      Screen grid info (for vision fallback)

Interaction:
  baremobile tap <ref>                 Tap element
  baremobile tap-xy <x> <y>           Tap by pixel coordinates
  baremobile tap-grid <cell>          Tap by grid cell (e.g. C5)
  baremobile type <ref> <text>         Type text (--clear to replace)
  baremobile press <key>               Press key (back, home, enter, ...)
  baremobile scroll <ref> <direction>  Scroll (up/down/left/right)
  baremobile swipe <x1> <y1> <x2> <y2> [--duration=N]
  baremobile long-press <ref>          Long-press element
  baremobile launch <pkg>              Launch app by package name
  baremobile intent <action> [--extra-string key=val ...]
  baremobile back                      Press Android back button
  baremobile home                      Press Android home button

Waiting:
  baremobile wait-text <text> [--timeout=N]
  baremobile wait-state <ref> <state> [--timeout=N]

Logging:
  baremobile logcat [--filter=TAG] [--clear]

MCP:
  baremobile mcp                       Start MCP server (JSON-RPC over stdio)

Options:
  --json                               Output JSON lines (for agent consumption)
`);
}
