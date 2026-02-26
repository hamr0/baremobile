#!/usr/bin/env node
/**
 * cli.js -- baremobile CLI entry point.
 *
 * See `baremobile` (no args) for full command reference.
 */

import { resolve } from 'node:path';
import { unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';

const args = process.argv.slice(2);
const cmd = args[0];
const jsonMode = hasFlag('--json');
const platform = parseFlag('--platform') || 'android';

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

/** Prompt user for input, return answer. */
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Prompt user and wait for Enter. */
async function waitForEnter(msg) {
  await prompt(`${msg} [press Enter to continue] `);
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
} else if (cmd === 'setup') {
  await cmdSetup();
} else if (cmd === 'ios' && args[1] === 'resign') {
  await cmdIosResign();
} else if (cmd === 'ios' && args[1] === 'teardown') {
  await cmdIosTeardown();
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
    platform,
  };

  try {
    const session = await startDaemon(opts, outputDir);
    if (jsonMode) {
      jsonOut({ ok: true, pid: session.pid, port: session.port, platform, outputDir });
    } else {
      process.stdout.write(`Session started (pid ${session.pid}, port ${session.port}, platform ${platform})\n`);
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
      jsonOut({ ok: true, pid: session.pid, port: session.port, platform: session.platform || 'android', startedAt: session.startedAt });
    } else {
      process.stdout.write(`Session running (pid ${session.pid}, port ${session.port}, platform ${session.platform || 'android'}, started ${session.startedAt})\n`);
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
    platform: parseFlag('--platform') || 'android',
  };
  const outputDir = parseFlag('--output-dir') || resolve('.baremobile');
  await runDaemon(opts, outputDir);
}


// --- Setup wizard ---

async function cmdSetup() {
  process.stdout.write('baremobile setup wizard\n\n');

  const choice = await prompt('Which platform? [1] Android  [2] iOS: ');
  if (choice === '2' || choice.toLowerCase() === 'ios') {
    await setupIos();
  } else {
    await setupAndroid();
  }
}

async function setupAndroid() {
  process.stdout.write('\n--- Android Setup ---\n\n');

  // Step 1: Check adb
  process.stdout.write('1. Checking adb... ');
  try {
    execFileSync('adb', ['version'], { stdio: 'pipe' });
    process.stdout.write('found\n');
  } catch {
    process.stdout.write('NOT FOUND\n');
    process.stdout.write('   Install Android SDK platform-tools: https://developer.android.com/tools/releases/platform-tools\n');
    process.stdout.write('   Then add to PATH and re-run setup.\n');
    return;
  }

  // Step 2: Check device
  process.stdout.write('2. Checking connected devices... ');
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8' });
    const lines = out.split('\n').filter(l => l.includes('\tdevice'));
    if (lines.length > 0) {
      process.stdout.write(`${lines.length} device(s) found\n`);
      for (const line of lines) {
        process.stdout.write(`   ${line.split('\t')[0]}\n`);
      }
    } else {
      process.stdout.write('NONE\n');
      process.stdout.write('   Enable USB debugging on your device:\n');
      process.stdout.write('   Settings > About phone > tap "Build number" 7 times\n');
      process.stdout.write('   Settings > Developer options > USB debugging > ON\n');
      process.stdout.write('   Connect USB cable and tap "Allow" on the debugging prompt.\n');
      await waitForEnter('Once connected, press Enter to verify');
      const out2 = execFileSync('adb', ['devices'], { encoding: 'utf8' });
      const lines2 = out2.split('\n').filter(l => l.includes('\tdevice'));
      if (lines2.length > 0) {
        process.stdout.write(`   ${lines2.length} device(s) found\n`);
      } else {
        process.stdout.write('   Still no device. Check connection and try again.\n');
        return;
      }
    }
  } catch (err) {
    process.stdout.write(`error: ${err.message}\n`);
    return;
  }

  process.stdout.write('\nAndroid setup complete. Run: baremobile open\n');
}

async function setupIos() {
  process.stdout.write('\n--- iOS Setup (QA only — USB required) ---\n\n');

  // Step 1: Check pymobiledevice3
  process.stdout.write('1. Checking pymobiledevice3... ');
  try {
    execFileSync('pymobiledevice3', ['version'], { stdio: 'pipe' });
    process.stdout.write('found\n');
  } catch {
    process.stdout.write('NOT FOUND\n');
    process.stdout.write('   Install: pip3 install pymobiledevice3\n');
    process.stdout.write('   Requires Python 3.12+\n');
    return;
  }

  // Step 2: Check USB device
  process.stdout.write('2. Checking USB device... ');
  try {
    const { listDevices } = await import('./src/usbmux.js');
    const devices = await listDevices();
    const usbDevices = devices.filter(d => d.connectionType === 'USB');
    if (usbDevices.length > 0) {
      process.stdout.write(`${usbDevices.length} device(s)\n`);
      for (const d of usbDevices) {
        process.stdout.write(`   ${d.serialNumber}\n`);
      }
    } else {
      process.stdout.write('NONE\n');
      process.stdout.write('   Connect iPhone via USB cable.\n');
      process.stdout.write('   Trust the computer on the device if prompted.\n');
      await waitForEnter('Once connected');
      const devices2 = await listDevices();
      if (devices2.filter(d => d.connectionType === 'USB').length === 0) {
        process.stdout.write('   Still no device. Check cable and trust prompt.\n');
        return;
      }
      process.stdout.write('   Device found.\n');
    }
  } catch (err) {
    process.stdout.write(`error: ${err.message}\n`);
    process.stdout.write('   Is usbmuxd running? Check: ls /var/run/usbmuxd\n');
    return;
  }

  // Step 3: Check Developer Mode
  process.stdout.write('3. Developer Mode: ensure it\'s enabled on your iPhone.\n');
  process.stdout.write('   Settings > Privacy & Security > Developer Mode > ON\n');
  await waitForEnter('Once enabled');

  // Step 4: Check WDA
  process.stdout.write('4. Checking WDA installation...\n');
  const wdaIpa = resolve('.wda/WebDriverAgent.ipa');
  if (existsSync(wdaIpa)) {
    process.stdout.write('   WDA IPA found at .wda/WebDriverAgent.ipa\n');
  } else {
    process.stdout.write('   WDA IPA not found. See ios/SETUP.md for installation.\n');
    process.stdout.write('   Quick: download WDA IPA and place at .wda/WebDriverAgent.ipa\n');
  }

  // Step 5: Start tunnel + WDA
  process.stdout.write('5. Starting iOS bridge (tunnel + DDI + WDA)...\n');
  process.stdout.write('   Run: bash ios/setup.sh\n');
  process.stdout.write('   (This requires elevated access for the USB tunnel.)\n');
  await waitForEnter('Once setup.sh has completed');

  // Step 6: Verify WDA
  process.stdout.write('6. Verifying WDA connection... ');
  try {
    const res = await fetch('http://localhost:8100/status', { signal: AbortSignal.timeout(3000) });
    const status = await res.json();
    if (status.value?.ready) {
      process.stdout.write('WDA ready\n');
    } else {
      process.stdout.write('WDA not ready (check setup.sh output)\n');
      return;
    }
  } catch {
    process.stdout.write('cannot reach localhost:8100\n');
    process.stdout.write('   WDA may not be running. Check: bash ios/setup.sh\n');
    return;
  }

  process.stdout.write('\niOS setup complete. Run: baremobile open --platform=ios\n');
}


// --- iOS resign ---

async function cmdIosResign() {
  process.stdout.write('baremobile ios resign — re-sign WDA cert\n\n');

  // Check AltServer exists
  const altserver = resolve('.wda/AltServer');
  if (!existsSync(altserver)) {
    errOut('.wda/AltServer not found. Download AltServer-Linux first.');
  }

  // Check USB device
  process.stdout.write('Checking USB device... ');
  try {
    const { listDevices } = await import('./src/usbmux.js');
    const devices = await listDevices();
    const usbDevices = devices.filter(d => d.connectionType === 'USB');
    if (usbDevices.length === 0) {
      errOut('No USB device connected. Connect iPhone first.');
    }
    process.stdout.write(`found (${usbDevices[0].serialNumber})\n`);
  } catch (err) {
    errOut(`usbmux error: ${err.message}`);
  }

  // Prompt for credentials
  const email = await prompt('Apple ID email: ');
  if (!email) errOut('Email required.');

  const password = await prompt('Apple ID password: ');
  if (!password) errOut('Password required.');

  // Run AltServer
  process.stdout.write('\nStarting AltServer...\n');
  const wdaIpa = resolve('.wda/WebDriverAgent.ipa');

  const child = spawn(altserver, [
    '-u', (await (await import('./src/usbmux.js')).listDevices())[0].serialNumber,
    '-a', email,
    '-p', password,
    wdaIpa,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; process.stdout.write(d); });
  child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });

  // Wait for 2FA prompt
  const twoFa = await prompt('\nEnter 2FA code from your phone: ');
  if (twoFa) {
    child.stdin.write(twoFa + '\n');
  }

  // Wait for completion
  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  if (exitCode === 0) {
    const { recordIosSigning } = await import('./src/ios-cert.js');
    recordIosSigning();
    process.stdout.write('\nWDA signed successfully. Timestamp recorded.\n');
    process.stdout.write('Remember to trust the developer profile on your device:\n');
    process.stdout.write('  Settings > General > VPN & Device Management > trust your Apple ID\n');
  } else {
    errOut(`AltServer exited with code ${exitCode}. Check output above.`);
  }
}


// --- iOS teardown ---

async function cmdIosTeardown() {
  const teardownScript = resolve('ios/teardown.sh');
  if (!existsSync(teardownScript)) {
    errOut('ios/teardown.sh not found.');
  }
  const child = spawn('bash', [teardownScript], { stdio: 'inherit' });
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  if (exitCode !== 0) {
    errOut(`teardown.sh exited with code ${exitCode}`);
  }
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
  process.stdout.write(`baremobile -- Mobile device control for autonomous agents

Session:
  baremobile open [--device=SERIAL] [--platform=android|ios]
                                     Start session (default: android)
  baremobile close                   Close session
  baremobile status                  Check session status

Screen:
  baremobile snapshot                ARIA snapshot -> .baremobile/screen-*.yml
  baremobile screenshot              Screenshot -> .baremobile/screenshot-*.png
  baremobile grid                    Screen grid info (Android only)

Interaction:
  baremobile tap <ref>               Tap element
  baremobile tap-xy <x> <y>         Tap by pixel coordinates
  baremobile tap-grid <cell>        Tap by grid cell (e.g. C5, Android only)
  baremobile type <ref> <text>       Type text (--clear to replace)
  baremobile press <key>             Press key (back, home, enter, ...)
  baremobile scroll <ref> <direction>  Scroll (up/down/left/right)
  baremobile swipe <x1> <y1> <x2> <y2> [--duration=N]
  baremobile long-press <ref>        Long-press element
  baremobile launch <pkg>            Launch app by identifier
  baremobile intent <action> [--extra-string key=val ...]  (Android only)
  baremobile back                    Navigate back
  baremobile home                    Go to home screen

Waiting:
  baremobile wait-text <text> [--timeout=N]
  baremobile wait-state <ref> <state> [--timeout=N]

Logging:
  baremobile logcat [--filter=TAG] [--clear]  (Android only)

Setup:
  baremobile setup                   Interactive setup wizard
  baremobile ios resign              Re-sign WDA cert (7-day Apple free cert)
  baremobile ios teardown            Kill iOS tunnel/WDA processes

MCP:
  baremobile mcp                     Start MCP server (JSON-RPC over stdio)

Options:
  --platform=android|ios             Target platform (default: android)
  --json                             Output JSON lines (for agent consumption)
`);
}
