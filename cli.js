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
    process.stdout.write('Session already running. Use `baremobile close` first.\n');
    process.exit(1);
  }

  const opts = {
    device: parseFlag('--device'),
  };

  try {
    const session = await startDaemon(opts, outputDir);
    process.stdout.write(`Session started (pid ${session.pid}, port ${session.port})\n`);
    process.stdout.write(`Output dir: ${outputDir}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function cmdStatus() {
  const { readSession, isAlive } = await import('./src/session-client.js');
  const outputDir = resolve('.baremobile');
  const session = readSession(outputDir);

  if (!session) {
    process.stdout.write('No session found.\n');
    process.exit(1);
  }

  const alive = await isAlive(outputDir);
  if (alive) {
    process.stdout.write(`Session running (pid ${session.pid}, port ${session.port}, started ${session.startedAt})\n`);
  } else {
    process.stdout.write(`Session stale (pid ${session.pid} not responding). Run \`baremobile close\` to clean up.\n`);
    process.exit(1);
  }
}

async function cmdProxy(command, cmdArgs) {
  const { sendCommand } = await import('./src/session-client.js');
  const outputDir = resolve('.baremobile');

  try {
    const result = await sendCommand(command, cmdArgs, outputDir);

    if (!result.ok) {
      process.stderr.write(`Error: ${result.error}\n`);
      process.exit(1);
    }

    // Print result
    if (result.file) {
      process.stdout.write(`${result.file}\n`);
    } else if (result.value !== undefined) {
      process.stdout.write(JSON.stringify(result.value) + '\n');
    } else if (command === 'close') {
      // Clean up session.json in case daemon didn't
      const sessionPath = join(outputDir, 'session.json');
      try { unlinkSync(sessionPath); } catch { /* already gone */ }
      process.stdout.write('Session closed.\n');
    } else {
      process.stdout.write('ok\n');
    }
  } catch (err) {
    if (command === 'close') {
      // Daemon may have exited before responding — that's fine
      const sessionPath = join(outputDir, 'session.json');
      try { unlinkSync(sessionPath); } catch { /* already gone */ }
      process.stdout.write('Session closed.\n');
    } else {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
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

Interaction:
  baremobile tap <ref>                 Tap element
  baremobile type <ref> <text>         Type text (--clear to replace)
  baremobile press <key>               Press key (back, home, enter, ...)
  baremobile scroll <ref> <direction>  Scroll (up/down/left/right)
  baremobile swipe <x1> <y1> <x2> <y2> [--duration=N]
  baremobile long-press <ref>          Long-press element
  baremobile launch <pkg>              Launch app by package name
  baremobile back                      Press Android back button
  baremobile home                      Press Android home button

MCP:
  baremobile mcp                       Start MCP server (JSON-RPC over stdio)
`);
}
