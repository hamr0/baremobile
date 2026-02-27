// Unified setup wizard for baremobile.
// All setup logic lives here — cli.js is thin routing.

import { resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';

const PID_FILE = '/tmp/baremobile-ios-pids';
const ANISETTE_FALLBACK = 'https://ani.sidestore.io';

// --- Host detection ---

/**
 * Detect host OS and package manager.
 * @returns {{ os: 'linux'|'macos'|'wsl', pkg: 'dnf'|'apt'|'brew'|null }}
 */
export function detectHost() {
  const plat = process.platform;
  if (plat === 'darwin') {
    return { os: 'macos', pkg: which('brew') ? 'brew' : null };
  }
  // Linux — check WSL
  let isWsl = false;
  try {
    const ver = readFileSync('/proc/version', 'utf8');
    isWsl = /microsoft|wsl/i.test(ver);
  } catch { /* not linux or no /proc */ }

  const os = isWsl ? 'wsl' : 'linux';
  const pkg = which('dnf') ? 'dnf' : which('apt') ? 'apt' : null;
  return { os, pkg };
}

/**
 * Sync PATH check for a binary. Returns full path or null.
 * @param {string} bin
 * @returns {string|null}
 */
export function which(bin) {
  try {
    return execFileSync('which', [bin], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

/**
 * Run a system command with elevated privileges (pkexec on Linux, sudo on WSL/macOS).
 * @param {string[]} args
 * @param {{ host?: object }} [opts]
 */
function elevatedExec(args, opts = {}) {
  const host = opts.host || detectHost();
  const cmd = host.os === 'wsl' ? 'sudo' : host.os === 'macos' ? 'sudo' : 'pkexec';
  return execFileSync(cmd, args, { stdio: 'inherit' });
}

/**
 * Find the Python interpreter that has pymobiledevice3 installed.
 * Tries pymobiledevice3 shebang first, then common python names.
 * @returns {string|null} python binary name or null
 */
export function findPython() {
  // Try extracting from pymobiledevice3 shebang
  try {
    const path = execFileSync('which', ['pymobiledevice3'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const first = readFileSync(path, 'utf8').split('\n')[0];
    const m = first.match(/#!\s*(.+)/);
    if (m) {
      const py = m[1].trim();
      try {
        execFileSync(py, ['-c', 'import pymobiledevice3'], { stdio: 'pipe' });
        return py;
      } catch { /* shebang python doesn't work */ }
    }
  } catch { /* pymobiledevice3 not in PATH */ }

  // Fallback: try common python names
  for (const py of ['python3', 'python3.12', 'python3.13', 'python3.11', 'python']) {
    try {
      execFileSync(py, ['-c', 'import pymobiledevice3'], { stdio: 'pipe' });
      return py;
    } catch { /* next */ }
  }
  return null;
}

/**
 * Run pymobiledevice3 synchronously, return stdout.
 * @param {string[]} args
 * @returns {string}
 */
function pmd3(args) {
  return execFileSync('pymobiledevice3', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
}

/**
 * Spawn pymobiledevice3 as background process.
 * @param {string[]} args
 * @param {{ env?: object }} [opts]
 * @returns {import('child_process').ChildProcess}
 */
function pmd3Bg(args, opts = {}) {
  return spawn('pymobiledevice3', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    ...opts,
  });
}

/**
 * Wait for a regex match in child stdout+stderr.
 * @param {import('child_process').ChildProcess} child
 * @param {RegExp} regex
 * @param {number} timeoutMs
 * @returns {Promise<string>} matched text
 */
function waitForOutput(child, regex, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let done = false;
    const finish = (err) => { if (!done) { done = true; clearTimeout(timer); reject(err); } };
    const onData = (d) => {
      output += d.toString();
      const m = output.match(regex);
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        resolve(output);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      finish(new Error(`Process exited (code ${code}): ${output.slice(0, 200)}`));
    });
    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for ${regex} (got: ${output.slice(0, 200)})`));
    }, timeoutMs);
  });
}

/**
 * Spawn AltServer and wait for 2FA prompt or error.
 * Returns { child, output } on success (ready for 2FA), or null on failure.
 * Automatically retries with fallback anisette server on 502.
 */
async function spawnAltServer(ui, altserver, args) {
  // Kill stale AltServer from previous attempts
  try { execFileSync('pkill', ['-f', 'AltServer'], { stdio: 'pipe' }); } catch { /* none running */ }

  const AUTH_ERROR = /Incorrect Content-Type|Could not install|Alert:.*Could not/i;
  const TWO_FA_READY = /enter two factor|enter.*2fa/i;
  const INSTALL_OK = /successfully installed|Finished!/i;
  const is502 = (s) => /status code: 502|anisette/i.test(s);

  // Only show meaningful AltServer lines — everything else is debug noise
  const SHOW = /^(Installing app|Requires two factor|Enter two factor|Finished|successfully installed|Could not install|Alert:|Failed to|error:)/i;

  function tryOnce(env) {
    const child = spawn(altserver, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    let output = '';
    let exitCode = null;
    const closed = new Promise((r) => child.on('close', (code) => { exitCode = code; r(code); }));
    const collect = (d) => {
      const s = d.toString();
      output += s;
      for (const line of s.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && SHOW.test(trimmed)) ui.write('   ' + trimmed + '\n');
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const done = new Promise((resolve) => {
      let resolved = false;
      const finish = (val) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(val); } };
      const check = () => {
        if (TWO_FA_READY.test(output)) return finish({ ok: true, needs2fa: true });
        if (INSTALL_OK.test(output)) return finish({ ok: true, needs2fa: false });
        if (AUTH_ERROR.test(output)) return finish({ ok: false });
      };
      child.stdout.on('data', check);
      child.stderr.on('data', check);
      child.on('close', () => finish({ ok: false }));
      const timer = setTimeout(() => finish({ ok: false, timeout: true }), 30000);
    });

    return { child, done, closed, getOutput: () => output, getExitCode: () => exitCode };
  }

  // First attempt — default anisette server
  let attempt = tryOnce({ ...process.env });
  let result = await attempt.done;

  if (!result.ok) {
    try { attempt.child.kill(); } catch { /* ignore */ }
    const output = attempt.getOutput();

    // Retry with fallback if 502/anisette and user hasn't set their own
    if (is502(output) && !process.env.ALTSERVER_ANISETTE_SERVER) {
      ui.warn('Default anisette server failed (502). Retrying with fallback...');
      attempt = tryOnce({ ...process.env, ALTSERVER_ANISETTE_SERVER: ANISETTE_FALLBACK });
      result = await attempt.done;

      if (!result.ok) {
        try { attempt.child.kill(); } catch { /* ignore */ }
        ui.fail('AltServer failed. Double-check your Apple ID email and password.');
        return null;
      }
      return { child: attempt.child, output: attempt.getOutput, needs2fa: result.needs2fa, closed: attempt.closed };
    }

    ui.fail('AltServer failed. Double-check your Apple ID email and password.');
    return null;
  }

  return { child: attempt.child, output: attempt.getOutput, needs2fa: result.needs2fa, closed: attempt.closed };
}

/**
 * Find a USB-connected iOS device via usbmuxd.
 * @returns {Promise<{deviceId: number, serial: string}>}
 */
async function findUsbDevice() {
  try {
    const { listDevices } = await import('./usbmux.js');
    const devices = await listDevices();
    if (devices.length === 0) return null;
    return devices[0]; // { deviceId, serial }
  } catch {
    return null; // usbmuxd not running or not available
  }
}

/**
 * Parse RSD address and port from pymobiledevice3 tunnel output.
 * @param {string} text
 * @returns {{ rsdAddr: string, rsdPort: string }|null}
 */
export function parseTunnelOutput(text) {
  const addr = text.match(/RSD Address:\s*(\S+)/i);
  const port = text.match(/RSD Port:\s*(\S+)/i);
  if (addr && port) return { rsdAddr: addr[1], rsdPort: port[1] };
  // Alternative format: "--rsd <addr> <port>"
  const alt = text.match(/--rsd\s+(\S+)\s+(\d+)/);
  if (alt) return { rsdAddr: alt[1], rsdPort: alt[2] };
  return null;
}

/**
 * Find WDA bundle ID on device via pymobiledevice3.
 * @returns {string|null}
 */
function findWdaBundle() {
  try {
    const json = pmd3(['apps', 'list']);
    const apps = JSON.parse(json);
    const wda = Object.keys(apps).find(k => k.includes('WebDriverAgent'));
    return wda || null;
  } catch { return null; }
}

/**
 * Parse WDA bundle from pymobiledevice3 apps list JSON string.
 * Exported for testing.
 * @param {string} json
 * @returns {string|null}
 */
export function parseWdaBundleFromJson(json) {
  try {
    const apps = JSON.parse(json);
    const wda = Object.keys(apps).find(k => k.includes('WebDriverAgent'));
    return wda || null;
  } catch { return null; }
}

function savePids(tunnelPid, wdaPid, fwdPid, rsdAddr, rsdPort) {
  let content = `${tunnelPid} ${wdaPid} ${fwdPid}`;
  if (rsdAddr && rsdPort) content += `\n${rsdAddr} ${rsdPort}`;
  writeFileSync(PID_FILE, content);
}

export function loadPids() {
  try {
    const raw = readFileSync(PID_FILE, 'utf8').trim();
    const lines = raw.split('\n');
    const [tunnel, wda, fwd] = lines[0].split(/\s+/).map(Number);
    let rsdAddr = null, rsdPort = null;
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s+/);
      if (parts.length >= 2) { rsdAddr = parts[0]; rsdPort = parts[1]; }
    }
    return { tunnel, wda, fwd, rsdAddr, rsdPort };
  } catch { return null; }
}


// --- Setup flows ---

/**
 * Top-level setup menu.
 * @param {object} ui — { prompt, waitForEnter, write, ok, fail, warn, step }
 */
export async function setupMenu(ui) {
  ui.write('baremobile setup\n\n');
  ui.write('  [1] Setup Android\n');
  ui.write('        Emulator · USB · WiFi · Termux\n');
  ui.write('  [2] Setup iPhone (from scratch)\n');
  ui.write('  [3] Start iPhone WDA server\n');
  ui.write('  [4] Renew iPhone WDA cert\n\n');

  const choice = await ui.prompt('Choice: ');
  switch (choice) {
    case '1': return setupAndroid(ui);
    case '2': return setupIos(ui);
    case '3': return startWda(ui);
    case '4': return renewCert(ui);
    default:
      ui.write('Invalid choice.\n');
  }
}

/**
 * Android setup wizard — sub-menu with 4 connection modes.
 */
export async function setupAndroid(ui) {
  ui.write('\n--- Android Setup ---\n\n');
  ui.write('  [1] Emulator         QA/testing — virtual device on this machine (~3GB install)\n');
  ui.write('  [2] USB device       QA/testing — physical phone plugged in via USB\n');
  ui.write('  [3] WiFi device      Personal assistant — real phone, same network\n');
  ui.write('  [4] Termux           Autonomous agent — phone controls itself, no host needed\n\n');

  const choice = await ui.prompt('Choice: ');
  switch (choice) {
    case '1': return setupEmulator(ui);
    case '2': return setupUsb(ui);
    case '3': return setupWifi(ui);
    case '4': return setupTermux(ui);
    default:
      ui.write('Invalid choice.\n');
  }
}

// --- Android sub-flows ---

/**
 * Emulator flow — install SDK if needed, create AVD, start emulator.
 */
async function setupEmulator(ui) {
  const host = detectHost();

  // Step 1: Ensure adb
  ui.step(1, 'Checking adb');
  if (!await ensureAdb(ui, host)) return;

  // Step 2: Check/install SDK
  ui.step(2, 'Checking Android SDK');
  const sdk = await ensureSdk(ui, host);
  if (!sdk) return;

  // SDK env — avdmanager and emulator need ANDROID_HOME to find AVDs and system images
  const sdkEnv = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };

  // Step 3: Check/create AVD
  ui.step(3, 'Checking AVD');
  const avdmanager = findSdkTool(sdk, 'avdmanager');
  if (!avdmanager) {
    ui.fail('avdmanager not found in SDK. Re-run setup.');
    return;
  }

  let hasAvd = false;
  try {
    const out = execFileSync(avdmanager, ['list', 'avd'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: sdkEnv });
    hasAvd = /Name:\s*baremobile\s*$/m.test(out);
  } catch { /* no avds */ }

  if (hasAvd) {
    ui.ok('AVD "baremobile" exists');
  } else {
    // Find installed system image — prefer google_apis_playstore, fall back to google_apis
    const sysImage = findSystemImage(sdk, sdkEnv);
    if (!sysImage) {
      ui.fail('No Android 35 system image found. Re-run setup to install SDK packages.');
      return;
    }
    ui.write(`   Creating AVD "baremobile" (Pixel 6, ${sysImage})...\n`);
    try {
      execFileSync(avdmanager, [
        'create', 'avd', '-n', 'baremobile',
        '-k', sysImage,
        '-d', 'pixel_6', '--force',
      ], { stdio: ['pipe', 'pipe', 'pipe'], input: 'no\n', env: sdkEnv });
      ui.ok('AVD "baremobile" created');
    } catch (err) {
      ui.fail(`AVD creation failed: ${err.message}`);
      return;
    }
  }

  // Step 4: Start emulator
  ui.step(4, 'Starting emulator');
  const emulator = findSdkTool(sdk, 'emulator');
  if (!emulator) {
    ui.fail('emulator binary not found in SDK. Ensure "emulator" package is installed.');
    return;
  }

  // Kill old emulator processes — clean slate for setup
  try {
    execFileSync('pkill', ['-f', 'qemu.*avd'], { stdio: 'pipe' });
    ui.warn('Killed old emulator process');
    await new Promise(r => setTimeout(r, 1000));
  } catch { /* none running */ }

  ui.write('   Launching emulator (first boot may take up to 2 minutes)...\n');
  let spawnError = null;
  const emuChild = spawn(emulator, ['-avd', 'baremobile'], {
    stdio: 'ignore', detached: true, env: sdkEnv,
  });
  emuChild.on('error', (err) => { spawnError = err; });
  emuChild.unref();

  // Brief pause to catch immediate spawn errors (EACCES, ENOENT)
  await new Promise(r => setTimeout(r, 500));
  if (spawnError) {
    ui.fail(`Emulator failed to start: ${spawnError.message}`);
    return;
  }

  // Poll for boot
  let booted = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const val = execFileSync('adb', ['-s', 'emulator-5554', 'shell', 'getprop', 'sys.boot_completed'], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (val === '1') { booted = true; break; }
    } catch { /* not ready yet */ }
  }

  if (booted) {
    ui.ok('Emulator booted');
  } else {
    ui.fail('Emulator did not boot within 120 seconds.');
    ui.write('   Check the emulator window for errors.\n');
    return;
  }

  // Step 5: Verify
  ui.step(5, 'Verifying');
  try {
    const devOut = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const emuLine = devOut.split('\n').find(l => /emulator-\d+/.test(l) && l.includes('device'));
    if (emuLine) {
      ui.ok(`Device: ${emuLine.trim()}`);
    } else {
      ui.warn('Emulator running but not showing in adb devices.');
    }
  } catch { /* ignore */ }

  ui.write('\nAndroid emulator setup complete. Run: baremobile open\n');
  ui.write('   Tip: adb install path/to/app.apk to install test apps.\n');
}

/**
 * USB device flow — check adb, check device, guide through USB debugging.
 */
async function setupUsb(ui) {
  const host = detectHost();

  // Step 1: Ensure adb
  ui.step(1, 'Checking adb');
  if (!await ensureAdb(ui, host)) return;

  // Step 2: Check device
  ui.step(2, 'Checking connected devices');
  const device = await checkAdbDevices(ui);
  if (!device) return;

  ui.write('\nAndroid USB setup complete. Run: baremobile open\n');
}

/**
 * WiFi device flow — adb over TCP/IP.
 */
async function setupWifi(ui) {
  const host = detectHost();

  // Step 1: Ensure adb
  ui.step(1, 'Checking adb');
  if (!await ensureAdb(ui, host)) return;

  // Step 2: Check for existing WiFi devices
  ui.step(2, 'Checking connected devices');
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const wifiLines = out.split('\n').filter(l => /\d+\.\d+\.\d+\.\d+:\d+\s+device/.test(l));
    if (wifiLines.length > 0) {
      ui.ok('WiFi device already connected');
      for (const l of wifiLines) ui.write(`   ${l.trim()}\n`);
      ui.write('\nAndroid WiFi setup complete. Run: baremobile open\n');
      return;
    }
  } catch { /* ignore */ }

  // Step 3: Guide connection
  ui.step(3, 'Connecting via WiFi');
  ui.write('   Two options:\n\n');
  ui.write('   A) From USB (one-time setup):\n');
  ui.write('      1. Connect phone via USB, ensure adb devices shows it\n');
  ui.write('      2. Run: adb tcpip 5555\n');
  ui.write('      3. Find phone IP: Settings > About phone > IP address\n');
  ui.write('      4. Run: adb connect <phone-ip>:5555\n');
  ui.write('      5. Unplug USB — WiFi connection persists until reboot\n\n');
  ui.write('   B) Already set up:\n');
  ui.write('      Enter your phone\'s IP address below.\n\n');

  const ip = await ui.prompt('Phone IP (or Enter to skip): ');
  if (ip) {
    const addr = ip.includes(':') ? ip : `${ip}:5555`;
    ui.write(`   Connecting to ${addr}...\n`);
    try {
      const out = execFileSync('adb', ['connect', addr], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (/connected/.test(out)) {
        ui.ok(`Connected to ${addr}`);
      } else {
        ui.fail(`Connection failed: ${out.trim()}`);
        ui.write('   Ensure phone and this machine are on the same network.\n');
        ui.write('   Ensure USB debugging is enabled and adb tcpip 5555 was run once.\n');
        return;
      }
    } catch (err) {
      ui.fail(`Connection failed: ${err.message}`);
      return;
    }
  } else {
    ui.write('   Skipped. Follow the steps above, then re-run setup.\n');
    return;
  }

  // Step 4: Verify
  ui.step(4, 'Verifying');
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = out.split('\n').filter(l => l.includes('\tdevice'));
    if (lines.length > 0) {
      ui.ok(`${lines.length} device(s) connected`);
    } else {
      ui.fail('No devices found after connect.');
      return;
    }
  } catch (err) {
    ui.fail(`Error: ${err.message}`);
    return;
  }

  ui.write('\nAndroid WiFi setup complete. Run: baremobile open\n');
}

/**
 * Termux flow — guide for on-device setup.
 */
async function setupTermux(ui) {
  const isTermux = !!process.env.TERMUX_VERSION;

  if (isTermux) {
    ui.step(1, 'Termux detected');
    ui.ok(`Termux ${process.env.TERMUX_VERSION}`);

    ui.step(2, 'Install packages');
    ui.write('   Run these in Termux:\n');
    ui.write('     pkg install android-tools nodejs-lts\n\n');

    ui.step(3, 'Enable wireless debugging');
    ui.write('   On the phone:\n');
    ui.write('     Settings > Developer options > Wireless debugging > ON\n');
    ui.write('     Tap "Pair device with pairing code"\n');
    ui.write('     Note the port + code, then run:\n');
    ui.write('       adb pair localhost:<PAIR_PORT> <CODE>\n\n');
    ui.write('   Then note the connect port (shown on Wireless debugging screen):\n');
    ui.write('       adb connect localhost:<CONNECT_PORT>\n\n');

    ui.step(4, 'Verify');
    ui.write('   adb devices should show localhost:<PORT>\n');
    ui.write('   Then run: npx baremobile open\n\n');

    ui.write('   Optional: install Termux:API for SMS, calls, GPS, camera:\n');
    ui.write('     1. Install Termux:API app from F-Droid\n');
    ui.write('     2. pkg install termux-api\n');
  } else {
    ui.step(1, 'Termux setup guide');
    ui.write('   Termux lets the phone control itself — no host machine needed.\n');
    ui.write('   The AI agent runs on the phone in Termux and controls the screen via ADB.\n\n');
    ui.write('   Setup steps:\n');
    ui.write('     1. Install Termux from F-Droid (NOT Google Play)\n');
    ui.write('        https://f-droid.org/packages/com.termux/\n');
    ui.write('     2. Open Termux and run:\n');
    ui.write('        pkg install android-tools nodejs-lts\n');
    ui.write('        npm install baremobile\n');
    ui.write('     3. Enable wireless debugging:\n');
    ui.write('        Settings > Developer options > Wireless debugging > ON\n');
    ui.write('     4. Pair: adb pair localhost:<PORT> <CODE>\n');
    ui.write('     5. Connect: adb connect localhost:<PORT>\n');
    ui.write('     6. Run: npx baremobile open\n\n');
    ui.write('   For SMS, calls, GPS, camera — also install Termux:API:\n');
    ui.write('     1. Install Termux:API app from F-Droid\n');
    ui.write('     2. In Termux: pkg install termux-api\n');
    ui.write('     3. Use: import * as api from \'baremobile/src/termux-api.js\'\n');
  }
}

// --- Android setup helpers ---

/**
 * Check for adb in PATH, offer to install if missing.
 * @param {object} ui
 * @param {object} host — from detectHost()
 * @returns {Promise<boolean>} true if adb available
 */
export async function ensureAdb(ui, host) {
  if (which('adb')) {
    ui.ok('adb found');
    return true;
  }

  ui.warn('adb not found');
  const ans = await ui.prompt('   Install adb now? [Y/n] ');
  if (ans.toLowerCase() === 'n') {
    ui.write('   Install manually: https://developer.android.com/tools/releases/platform-tools\n');
    return false;
  }

  try {
    if (host.os === 'macos' && host.pkg === 'brew') {
      ui.write('   brew install android-platform-tools\n');
      execFileSync('brew', ['install', 'android-platform-tools'], { stdio: 'inherit' });
    } else if (host.pkg === 'dnf') {
      ui.write('   Installing android-tools via dnf...\n');
      elevatedExec([which('dnf'), 'install', '-y', 'android-tools'], { host });
    } else if (host.pkg === 'apt') {
      ui.write('   Installing android-tools-adb via apt...\n');
      elevatedExec([which('apt'), 'install', '-y', 'android-tools-adb'], { host });
    } else {
      ui.fail('No supported package manager found.');
      ui.write('   Install manually: https://developer.android.com/tools/releases/platform-tools\n');
      return false;
    }
    if (which('adb')) {
      ui.ok('adb installed');
      return true;
    }
    ui.fail('adb still not found after install. Check PATH.');
    return false;
  } catch (err) {
    ui.fail(`Install failed: ${err.message}`);
    return false;
  }
}

/**
 * Find the Android SDK root, or install command-line tools if missing.
 * Returns the SDK root path, or null on failure.
 * @param {object} ui
 * @param {object} host
 * @returns {Promise<string|null>}
 */
export async function ensureSdk(ui, host) {
  // Check existing SDK
  const existing = findSdkRoot();
  if (existing) {
    const sdkm = findSdkTool(existing, 'sdkmanager');
    if (sdkm) {
      ui.ok(`SDK found: ${existing}`);
      // Ensure required packages
      return await installSdkPackages(ui, sdkm, existing);
    }
  }

  // SDK not found — install
  ui.warn('Android SDK not found');
  ui.write('   Will install:\n');
  ui.write('     - Command-line tools\n');
  ui.write('     - platform-tools (~15MB)\n');
  ui.write('     - emulator (~300MB)\n');
  ui.write('     - Android 35 platform (~70MB)\n');
  ui.write('     - System image with Google APIs (~2.5GB)\n');
  ui.write('   Total: ~3GB\n\n');

  const ans = await ui.prompt('   Install Android SDK? [Y/n] ');
  if (ans.toLowerCase() === 'n') return null;

  let sdkRoot;
  try {
    if (host.os === 'macos' && host.pkg === 'brew') {
      ui.write('   brew install --cask android-commandlinetools\n');
      execFileSync('brew', ['install', '--cask', 'android-commandlinetools'], { stdio: 'inherit' });
      // Homebrew installs to HOMEBREW_PREFIX/share/android-commandlinetools
      const brewPrefix = execFileSync('brew', ['--prefix'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      sdkRoot = join(brewPrefix, 'share', 'android-commandlinetools');
    } else {
      // Linux/WSL — download cmdline-tools zip
      sdkRoot = join(homedir(), 'Android', 'Sdk');
      const cmdlineDir = join(sdkRoot, 'cmdline-tools', 'latest');
      if (!existsSync(cmdlineDir)) {
        ui.write('   Downloading command-line tools...\n');
        mkdirSync(cmdlineDir, { recursive: true });
        const zipUrl = 'https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip';
        const zipPath = '/tmp/android-cmdline-tools.zip';
        execFileSync('curl', ['-fsSL', '-o', zipPath, zipUrl], { stdio: 'inherit', timeout: 120000 });
        // Extract to temp, then move contents to latest/
        const tmpDir = '/tmp/android-cmdline-extract';
        execFileSync('rm', ['-rf', tmpDir], { stdio: 'pipe' });
        mkdirSync(tmpDir, { recursive: true });
        execFileSync('unzip', ['-q', '-o', zipPath, '-d', tmpDir], { stdio: 'inherit' });
        // The zip contains cmdline-tools/ — move its contents
        const extractedDir = join(tmpDir, 'cmdline-tools');
        if (existsSync(extractedDir)) {
          execFileSync('sh', ['-c', `cp -r ${extractedDir}/* ${cmdlineDir}/`], { stdio: 'pipe' });
        }
        execFileSync('rm', ['-rf', tmpDir, zipPath], { stdio: 'pipe' });
        ui.ok('Command-line tools installed');
      }
    }
  } catch (err) {
    ui.fail(`SDK install failed: ${err.message}`);
    return null;
  }

  const sdkm = findSdkTool(sdkRoot, 'sdkmanager');
  if (!sdkm) {
    ui.fail('sdkmanager not found after install.');
    return null;
  }

  return await installSdkPackages(ui, sdkm, sdkRoot);
}

/**
 * Install required SDK packages via sdkmanager.
 * @returns {string|null} sdkRoot on success
 */
async function installSdkPackages(ui, sdkmanager, sdkRoot) {
  const sdkEnv = { ...process.env, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot };

  // Check which packages are installed
  let installed = '';
  try {
    installed = execFileSync(sdkmanager, ['--list_installed'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: sdkEnv,
    });
  } catch {
    try {
      installed = execFileSync(sdkmanager, ['--list'], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: sdkEnv,
      });
    } catch { /* ignore */ }
  }

  // Determine which system image to install — accept either google_apis or google_apis_playstore
  const hasAnyImage = installed.includes('system-images;android-35;google_apis');
  const packages = [
    'platform-tools',
    'emulator',
    'platforms;android-35',
  ];
  if (!hasAnyImage) {
    packages.push('system-images;android-35;google_apis_playstore;x86_64');
  }

  const missing = packages.filter(p => !installed.includes(p));
  if (missing.length === 0) {
    ui.ok('All SDK packages installed');
    return sdkRoot;
  }

  ui.write(`   Installing ${missing.length} SDK package(s)...\n`);
  try {
    // Accept licenses first
    execFileSync('sh', ['-c', `yes | ${sdkmanager} --licenses`], {
      stdio: 'pipe',
      env: { ...process.env, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot },
      timeout: 30000,
    });
  } catch { /* licenses may already be accepted */ }

  try {
    execFileSync(sdkmanager, missing, {
      stdio: 'inherit',
      env: { ...process.env, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot },
      timeout: 600000, // 10 min for large downloads
    });
    ui.ok('SDK packages installed');
    return sdkRoot;
  } catch (err) {
    ui.fail(`SDK package install failed: ${err.message}`);
    return null;
  }
}

/**
 * Find Android SDK root from env vars or common paths.
 * @returns {string|null}
 */
export function findSdkRoot() {
  // Check env vars
  for (const envVar of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const val = process.env[envVar];
    if (val && existsSync(val)) return val;
  }
  // Common paths
  const home = homedir();
  const candidates = [
    join(home, 'Android', 'Sdk'),
    join(home, 'android-sdk'),
    '/usr/lib/android-sdk',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Check if sdkmanager is in PATH and infer
  const sdkm = which('sdkmanager');
  if (sdkm) {
    // sdkmanager is typically at SDK/cmdline-tools/latest/bin/sdkmanager
    const parts = sdkm.split('/');
    const idx = parts.indexOf('cmdline-tools');
    if (idx > 0) return parts.slice(0, idx).join('/');
  }
  return null;
}

/**
 * Find a tool binary in the SDK (sdkmanager, avdmanager, emulator).
 * @param {string} sdkRoot
 * @param {string} tool
 * @returns {string|null}
 */
export function findSdkTool(sdkRoot, tool) {
  if (!sdkRoot) return null;
  const candidates = [
    join(sdkRoot, 'cmdline-tools', 'latest', 'bin', tool),
    join(sdkRoot, 'cmdline-tools', 'bin', tool),
    join(sdkRoot, 'tools', 'bin', tool),
    join(sdkRoot, 'emulator', tool),      // emulator binary inside emulator/ package dir
    join(sdkRoot, tool),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch { /* stat failed */ }
  }
  // Fallback: check PATH
  return which(tool);
}

/**
 * Find an installed Android 35 system image in the SDK.
 * Prefers google_apis_playstore, falls back to google_apis.
 * @param {string} sdkRoot
 * @param {object} sdkEnv
 * @returns {string|null} system image package string
 */
function findSystemImage(sdkRoot, sdkEnv) {
  const sdkmanager = findSdkTool(sdkRoot, 'sdkmanager');
  if (!sdkmanager) return null;

  let installed = '';
  try {
    installed = execFileSync(sdkmanager, ['--list_installed'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: sdkEnv,
    });
  } catch {
    try {
      installed = execFileSync(sdkmanager, ['--list'], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: sdkEnv,
      });
    } catch { return null; }
  }

  // Match installed system images for android-35
  const playstore = 'system-images;android-35;google_apis_playstore;x86_64';
  const plain = 'system-images;android-35;google_apis;x86_64';
  if (installed.includes(playstore)) return playstore;
  if (installed.includes(plain)) return plain;
  return null;
}

/**
 * Check adb devices, handle unauthorized/offline/missing states.
 * @returns {Promise<boolean>} true if device found
 */
async function checkAdbDevices(ui) {
  try {
    const out = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = out.split('\n').slice(1).filter(l => l.trim());

    // Check for connected devices
    const ready = lines.filter(l => l.includes('\tdevice'));
    if (ready.length > 0) {
      ui.ok(`${ready.length} device(s) found`);
      for (const line of ready) {
        ui.write(`   ${line.trim()}\n`);
      }
      return true;
    }

    // Check for unauthorized
    const unauth = lines.filter(l => l.includes('\tunauthorized'));
    if (unauth.length > 0) {
      ui.warn('Device connected but not authorized');
      ui.write('   Tap "Allow USB debugging" on your device.\n');
      ui.write('   Check "Always allow from this computer" for convenience.\n');
      await ui.waitForEnter('Once authorized');
      return await checkAdbDevices(ui);
    }

    // Check for offline
    const offline = lines.filter(l => l.includes('\toffline'));
    if (offline.length > 0) {
      ui.warn('Device is offline');
      ui.write('   Try: disconnect and reconnect USB cable.\n');
      ui.write('   If that fails: adb kill-server && adb start-server\n');
      await ui.waitForEnter('Once reconnected');
      return await checkAdbDevices(ui);
    }

    // No device at all
    ui.warn('No devices found');
    ui.write('   Requirements:\n');
    ui.write('     - Android 10+ (2019 or newer)\n');
    ui.write('     - USB debugging enabled:\n');
    ui.write('       Settings > About phone > tap "Build number" 7 times\n');
    ui.write('       Settings > Developer options > USB debugging > ON\n');
    ui.write('     - USB cable connected, tap "Allow" on the debugging prompt\n');
    await ui.waitForEnter('Once connected');

    const out2 = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const ready2 = out2.split('\n').filter(l => l.includes('\tdevice'));
    if (ready2.length > 0) {
      ui.ok(`${ready2.length} device(s) found`);
      return true;
    }
    ui.fail('Still no device. Check connection and try again.');
    return false;
  } catch (err) {
    ui.fail(`Error: ${err.message}`);
    return false;
  }
}

/**
 * Full iPhone from-scratch setup — 10 steps.
 */
export async function setupIos(ui) {
  ui.write('\n--- iOS Setup (from scratch) ---\n\n');

  const host = detectHost();

  // Step 1: Detect host OS
  ui.step(1, 'Detecting host OS');
  ui.ok(`${host.os}${host.pkg ? ` (${host.pkg})` : ''}`);

  // Step 2: Check pymobiledevice3
  ui.step(2, 'Checking pymobiledevice3');
  if (which('pymobiledevice3')) {
    ui.ok('pymobiledevice3 found');
  } else {
    ui.fail('pymobiledevice3 NOT FOUND');
    ui.write('   Install:\n');
    if (host.os === 'macos') {
      ui.write('     pip3 install pymobiledevice3  (or brew install pymobiledevice3)\n');
    } else {
      ui.write('     pip3 install pymobiledevice3\n');
    }
    return;
  }

  // Step 3: Check AltServer
  ui.step(3, 'Checking AltServer');
  const altserver = resolve('.wda/AltServer');
  if (existsSync(altserver)) {
    ui.ok('AltServer found at .wda/AltServer');
  } else {
    ui.warn('AltServer not found at .wda/AltServer');
    if (host.os === 'macos') {
      ui.write('   Install: brew install altserver OR download from altstore.io\n');
    } else {
      ui.write('   Download from https://github.com/NyaMisty/AltServer-Linux/releases\n');
      ui.write('   Place at .wda/AltServer and chmod +x\n');
    }
    ui.write('   (Needed to sign WDA — skip if WDA is already installed on device)\n');
  }

  // Step 4: Check libdns_sd (Linux only)
  if (host.os === 'linux' || host.os === 'wsl') {
    ui.step(4, 'Checking libdns_sd (mDNS)');
    let hasLib = false;
    try {
      const ldout = execFileSync('ldconfig', ['-p'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      hasLib = ldout.includes('libdns_sd');
    } catch { /* ldconfig not available */ }
    if (!hasLib) hasLib = existsSync('/usr/lib64/libdns_sd.so') || existsSync('/usr/lib/libdns_sd.so');

    if (hasLib) {
      ui.ok('libdns_sd available');
    } else {
      ui.warn('libdns_sd missing (needed for AltServer signing)');
      if (host.pkg === 'dnf') {
        const ans = await ui.prompt('   Install avahi-compat-libdns_sd? [Y/n] ');
        if (ans.toLowerCase() !== 'n') {
          try {
            execFileSync('sudo', ['dnf', 'install', '-y', 'avahi-compat-libdns_sd'], { stdio: 'inherit' });
            // Create symlink if needed
            if (!existsSync('/usr/lib64/libdns_sd.so') && existsSync('/usr/lib64/libdns_sd.so.1')) {
              execFileSync('sudo', ['ln', '-sf', '/usr/lib64/libdns_sd.so.1', '/usr/lib64/libdns_sd.so'], { stdio: 'inherit' });
            }
            ui.ok('libdns_sd installed');
          } catch { ui.fail('Installation failed. Install manually and re-run.'); }
        }
      } else if (host.pkg === 'apt') {
        const ans = await ui.prompt('   Install libavahi-compat-libdnssd-dev? [Y/n] ');
        if (ans.toLowerCase() !== 'n') {
          try {
            execFileSync('sudo', ['apt', 'install', '-y', 'libavahi-compat-libdnssd-dev'], { stdio: 'inherit' });
            ui.ok('libdns_sd installed');
          } catch { ui.fail('Installation failed. Install manually and re-run.'); }
        }
      } else {
        ui.write('   Install libdns_sd manually for your distro.\n');
      }
    }
  } else {
    ui.step(4, 'Checking libdns_sd');
    ui.ok('Built-in on macOS');
  }

  // Step 5: Connect iPhone USB
  ui.step(5, 'Checking USB device');
  let device = await findUsbDevice();
  if (device) {
    ui.ok(`Device found: ${device.serial}`);
  } else {
    ui.warn('No USB device detected');
    ui.write('   Connect iPhone via USB cable.\n');
    ui.write('   Tap "Trust" on the device if prompted.\n');
    await ui.waitForEnter('Once connected');
    device = await findUsbDevice();
    if (!device) {
      ui.fail('Still no device. Check cable and trust prompt.');
      return;
    }
    ui.ok(`Device found: ${device.serial}`);
  }

  // Step 6: Sign & install WDA
  ui.step(6, 'Checking WDA installation');
  const bundle = findWdaBundle();
  if (bundle) {
    ui.ok(`WDA installed: ${bundle}`);
  } else {
    ui.warn('WDA not installed on device');
    if (!existsSync(altserver)) {
      ui.fail('AltServer not found — cannot sign WDA. Place at .wda/AltServer');
      return;
    }
    const wdaIpa = resolve('.wda/WebDriverAgent.ipa');
    if (!existsSync(wdaIpa)) {
      ui.fail('WDA IPA not found at .wda/WebDriverAgent.ipa');
      ui.write('   Download WebDriverAgent.ipa and place it there.\n');
      return;
    }
    // AltServer signing flow
    ui.write('   You need an Apple ID (free account works). Not sure if you have one?\n');
    ui.write('   Try logging in at https://developer.apple.com/\n\n');
    const email = await ui.prompt('Apple ID email: ');
    if (!email) { ui.fail('Email required.'); return; }
    const password = await ui.prompt('Apple ID password: ');
    if (!password) { ui.fail('Password required.'); return; }

    ui.write('Starting AltServer...\n');
    const altArgs = ['-u', device.serial, '-a', email, '-p', password, wdaIpa];
    const result = await spawnAltServer(ui, altserver, altArgs);
    if (!result) return;

    if (result.needs2fa) {
      const twoFa = await ui.prompt('Enter 2FA code from your phone: ');
      if (twoFa) result.child.stdin.write(twoFa + '\n');
    }
    const exitCode = await result.closed;
    if (exitCode !== 0) {
      ui.fail(`AltServer failed. Output:\n${result.output().slice(-300)}`);
      return;
    }
    const { recordIosSigning } = await import('./ios-cert.js');
    recordIosSigning();
    ui.ok('WDA signed and installed');
  }

  // Step 7: Device settings (Developer Mode + VPN trust + UI Automation)
  ui.step(7, 'Device settings');
  let devModeOk = false;
  try {
    const out = pmd3(['mounter', 'query-developer-mode-status']);
    devModeOk = out.includes('true');
  } catch { /* can't check */ }

  if (devModeOk) {
    ui.ok('[1] Developer Mode: ON');
  } else {
    ui.warn('[1] Developer Mode: needs to be enabled');
    ui.write('      Settings > Privacy & Security > Developer Mode > ON\n');
    ui.write('      Device will restart. Confirm "Enable" after reboot.\n');
  }
  ui.write('   [2] Trust developer profile:\n');
  ui.write('      Settings > General > VPN & Device Management > tap your Apple ID > Trust\n');
  ui.write('   [3] Enable UI Automation:\n');
  ui.write('      Settings > Developer > Enable UI Automation > ON\n');
  await ui.waitForEnter('Once all three are done');

  // Step 9: Start WDA server
  ui.step(8, 'Starting WDA server');
  await startWda(ui, '8');

  // Step 9: Verify
  ui.step(9, 'Final verification');
  try {
    const res = await fetch('http://localhost:8100/status', { signal: AbortSignal.timeout(3000) });
    const status = await res.json();
    if (status.value?.ready) {
      ui.ok('WDA ready at http://localhost:8100');
      ui.write('\niOS setup complete. Run: baremobile open --platform=ios\n');
    } else {
      ui.fail('WDA not ready. Check output above.');
    }
  } catch {
    ui.fail('Cannot reach localhost:8100. Check output above.');
  }
}

/**
 * Start WDA server — 5 steps. For when iPhone is already set up.
 * @param {object} ui
 * @param {string} [prefix] — step prefix for sub-steps (e.g. '9' → 9a, 9b, ...)
 */
export async function startWda(ui, prefix) {
  const s = (n) => prefix ? `${prefix}${String.fromCharCode(96 + n)}` : n;
  const host = detectHost();

  // Step 1: Check USB device
  ui.step(s(1), 'Checking USB device');
  let device = await findUsbDevice();
  if (!device) {
    ui.warn('No USB device detected');
    ui.write('   Connect iPhone via USB cable.\n');
    ui.write('   Tap "Trust" on the device if prompted.\n');
    await ui.waitForEnter('Once connected');
    device = await findUsbDevice();
    if (!device) {
      ui.fail('Still no device. Check cable and trust prompt.');
      return;
    }
  }
  ui.ok(`Device: ${device.serial}`);

  // Step 2: Start tunnel
  ui.step(s(2), 'Starting tunnel (requires elevated access)');
  // Kill stale tunnels
  try {
    execFileSync('pkill', ['-f', 'pymobiledevice3.*start-tunnel'], { stdio: 'pipe' });
    ui.warn('Killed stale tunnel processes');
  } catch { /* none running */ }

  let tunnelChild;
  if (host.os === 'macos') {
    // macOS: prefer xcrun devicectl if Xcode available, else sudo
    if (which('xcrun')) {
      ui.write('   Using xcrun devicectl...\n');
      tunnelChild = spawn('xcrun', ['devicectl', 'device', 'tunnel', '--udid', device.serial], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });
    } else {
      ui.write('   Using sudo pymobiledevice3...\n');
      tunnelChild = spawn('sudo', ['pymobiledevice3', 'lockdown', 'start-tunnel'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });
    }
  } else if (host.os === 'wsl') {
    // WSL: sudo (no polkit)
    const py = findPython();
    const env = py ? { ...process.env } : process.env;
    tunnelChild = spawn('sudo', ['pymobiledevice3', 'lockdown', 'start-tunnel'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env,
    });
  } else {
    // Linux: pkexec — must use full paths (pkexec resets PATH)
    const pmd3Path = which('pymobiledevice3');
    if (!pmd3Path) {
      ui.fail('pymobiledevice3 not in PATH');
      return;
    }
    const py = findPython();
    const envArgs = [];
    if (py) {
      try {
        const sitePackages = execFileSync(py, ['-c', 'import site; print(site.getusersitepackages())'], {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (sitePackages) envArgs.push('env', `PYTHONPATH=${sitePackages}`);
      } catch { /* best effort */ }
    }
    ui.write('   Starting tunnel via pkexec (authenticate in popup)...\n');
    tunnelChild = spawn('pkexec', [...envArgs, pmd3Path, 'lockdown', 'start-tunnel'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
  }

  // Wait for RSD Port (last line of tunnel output — "tunnel created" arrives first but RSD lines follow)
  let tunnelOutput;
  try {
    tunnelOutput = await waitForOutput(tunnelChild, /RSD Port:\s*\d+/i, 20000);
  } catch (err) {
    try { tunnelChild.kill(); } catch { /* ignore */ }
    if (/not authorized/i.test(err.message)) {
      ui.fail('Tunnel requires elevated access — authentication was cancelled.');
      ui.write('   Re-run setup and authenticate when prompted.\n');
    } else {
      ui.fail(`Tunnel failed: ${err.message}`);
    }
    return;
  }

  const rsd = parseTunnelOutput(tunnelOutput);
  if (!rsd) {
    ui.fail('Could not parse RSD address/port from tunnel output');
    try { tunnelChild.kill(); } catch { /* ignore */ }
    return;
  }
  ui.ok(`Tunnel: ${rsd.rsdAddr} port ${rsd.rsdPort} (PID ${tunnelChild.pid})`);

  // Step 3: Mount DDI
  ui.step(s(3), 'Mounting Developer Disk Image');
  try {
    pmd3(['mounter', 'auto-mount', '--rsd', rsd.rsdAddr, rsd.rsdPort]);
    ui.ok('DDI mounted');
  } catch (err) {
    // "already mounted" is fine
    if (err.stderr && err.stderr.includes('already')) {
      ui.ok('DDI already mounted');
    } else if (err.message && err.message.includes('already')) {
      ui.ok('DDI already mounted');
    } else {
      ui.warn(`DDI mount: ${err.message || 'unknown error'} (may already be mounted)`);
    }
  }

  // Step 4: Launch WDA
  ui.step(s(4), 'Launching WDA');
  const bundle = findWdaBundle();
  if (!bundle) {
    ui.fail('WDA not installed on device. Run full setup (option 2) first.');
    return;
  }

  const py = findPython();
  if (!py) {
    ui.fail('No Python with pymobiledevice3 found');
    return;
  }

  const wdaChild = spawn(py, ['-c', `
import asyncio
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.testmanaged.xcuitest import XCUITestService
async def main():
    rsd = RemoteServiceDiscoveryService(('${rsd.rsdAddr}', ${rsd.rsdPort}))
    await rsd.connect()
    XCUITestService(rsd).run('${bundle}')
asyncio.run(main())
`], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });

  let wdaOutput = '';
  wdaChild.stdout.on('data', (d) => { wdaOutput += d.toString(); });
  wdaChild.stderr.on('data', (d) => { wdaOutput += d.toString(); });
  ui.ok(`WDA launching (PID ${wdaChild.pid})...`);

  // Step 5: Port forward + verify
  ui.step(s(5), 'Port forwarding and verification');

  // Kill stale port 8100
  try {
    execFileSync('fuser', ['-k', '8100/tcp'], { stdio: 'pipe' });
    await new Promise(r => setTimeout(r, 500));
  } catch { /* nothing on 8100 */ }

  // Start usbmux forwarder
  const { forward } = await import('./usbmux.js');
  let fwdServer;
  try {
    fwdServer = await forward(device.deviceId, 8100, 8100);
    ui.ok('Port forward: localhost:8100 -> device:8100');
  } catch (err) {
    ui.fail(`Port forward failed: ${err.message}`);
    return;
  }

  // Retry /status 3x at 2s intervals
  let wdaReady = false;
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch('http://localhost:8100/status', { signal: AbortSignal.timeout(3000) });
      const status = await res.json();
      if (status.value?.ready) { wdaReady = true; break; }
    } catch { /* retry */ }
  }

  // Save PIDs for teardown
  savePids(tunnelChild.pid, wdaChild.pid, process.pid, rsd.rsdAddr, rsd.rsdPort);

  // Unref children + their pipes + forwarder so Node can exit
  tunnelChild.stdout.unref();
  tunnelChild.stderr.unref();
  tunnelChild.unref();
  wdaChild.stdout.unref();
  wdaChild.stderr.unref();
  wdaChild.unref();
  if (fwdServer) fwdServer.unref();

  if (wdaReady) {
    ui.ok('WDA ready at http://localhost:8100');
    ui.write(`\n  Tunnel PID: ${tunnelChild.pid}\n`);
    ui.write(`  WDA PID:    ${wdaChild.pid}\n`);
    ui.write(`  PIDs saved to ${PID_FILE}\n`);
    ui.write(`  To stop: baremobile ios teardown\n\n`);
  } else if (/not been explicitly trusted|invalid.*code signature/i.test(wdaOutput)) {
    ui.fail('WDA launch blocked — developer profile not trusted on device.');
    ui.write('   Settings > General > VPN & Device Management > tap your Apple ID > Trust\n');
    await ui.waitForEnter('Once trusted, press Enter to retry');
    // Retry WDA launch only (tunnel + DDI + forward still alive)
    try { wdaChild.kill(); } catch { /* ignore */ }
    const retryChild = spawn(py, ['-c', `
import asyncio
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.testmanaged.xcuitest import XCUITestService
async def main():
    rsd = RemoteServiceDiscoveryService(('${rsd.rsdAddr}', ${rsd.rsdPort}))
    await rsd.connect()
    XCUITestService(rsd).run('${bundle}')
asyncio.run(main())
`], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    retryChild.stdout.on('data', () => {});
    retryChild.stderr.on('data', () => {});
    ui.write('   Relaunching WDA...\n');
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch('http://localhost:8100/status', { signal: AbortSignal.timeout(3000) });
        const status = await res.json();
        if (status.value?.ready) { wdaReady = true; break; }
      } catch { /* retry */ }
    }
    savePids(tunnelChild.pid, retryChild.pid, process.pid, rsd.rsdAddr, rsd.rsdPort);
    retryChild.stdout.unref();
    retryChild.stderr.unref();
    retryChild.unref();
    if (!wdaReady) ui.fail('WDA still not responding. Run: baremobile ios teardown && baremobile setup');
  } else {
    ui.fail('WDA not responding after 3 attempts');
    if (wdaOutput.trim()) ui.write(`   ${wdaOutput.trim().split('\n').pop()}\n`);
  }
}

/**
 * Renew WDA cert via AltServer — 4 steps.
 */
export async function renewCert(ui) {
  ui.write('baremobile ios resign — re-sign WDA cert\n\n');

  // Step 1: Check AltServer
  ui.step(1, 'Checking AltServer');
  const altserver = resolve('.wda/AltServer');
  if (!existsSync(altserver)) {
    ui.fail('.wda/AltServer not found. Download AltServer-Linux first.');
    return;
  }
  ui.ok('AltServer found');

  // Step 2: Check USB device
  ui.step(2, 'Checking USB device');
  let device = await findUsbDevice();
  if (!device) {
    ui.warn('No USB device detected');
    ui.write('   Connect iPhone via USB cable.\n');
    ui.write('   Tap "Trust" on the device if prompted.\n');
    await ui.waitForEnter('Once connected');
    device = await findUsbDevice();
    if (!device) {
      ui.fail('Still no device. Check cable and trust prompt.');
      return;
    }
  }
  ui.ok(`Device: ${device.serial}`);

  // Step 3: Sign
  ui.step(3, 'Signing WDA');
  ui.write('   You need an Apple ID (free account works). Not sure if you have one?\n');
  ui.write('   Try logging in at https://developer.apple.com/\n\n');
  const email = await ui.prompt('Apple ID email: ');
  if (!email) { ui.fail('Email required.'); return; }
  const password = await ui.prompt('Apple ID password: ');
  if (!password) { ui.fail('Password required.'); return; }

  const wdaIpa = resolve('.wda/WebDriverAgent.ipa');
  ui.write('Starting AltServer...\n');
  const altArgs = ['-u', device.serial, '-a', email, '-p', password, wdaIpa];
  const result = await spawnAltServer(ui, altserver, altArgs);
  if (!result) return;

  if (result.needs2fa) {
    const twoFa = await ui.prompt('Enter 2FA code from your phone: ');
    if (twoFa) result.child.stdin.write(twoFa + '\n');
  }
  const exitCode = await result.closed;
  if (exitCode !== 0) {
    ui.fail(`AltServer failed. Output:\n${result.output().slice(-300)}`);
    return;
  }

  // Step 4: Record
  ui.step(4, 'Recording signing timestamp');
  const { recordIosSigning, checkIosCert } = await import('./ios-cert.js');
  recordIosSigning();
  const warning = checkIosCert();
  ui.ok('WDA signed successfully. Timestamp recorded.');
  if (warning) ui.warn(warning);
  ui.write('\nRemember to trust the developer profile on your device:\n');
  ui.write('  Settings > General > VPN & Device Management > trust your Apple ID\n');
}

/**
 * Kill iOS tunnel/WDA/forward processes.
 */
export async function teardown() {
  const pids = loadPids();
  if (pids) {
    process.stdout.write(`Stopping tunnel (${pids.tunnel}), WDA (${pids.wda}), forward (${pids.fwd})...\n`);

    // Tunnel is root-owned (started via pkexec) — need elevated kill
    const host = detectHost();
    const killCmd = host.os === 'wsl' ? 'sudo' : 'pkexec';
    try {
      execFileSync(killCmd, ['kill', '-9', String(pids.tunnel)], { stdio: 'pipe' });
    } catch {
      try { process.kill(pids.tunnel, 'SIGKILL'); } catch { /* already dead */ }
    }
    try { process.kill(pids.wda, 'SIGKILL'); } catch { /* already dead */ }
    try { process.kill(pids.fwd, 'SIGKILL'); } catch { /* already dead */ }

    try { unlinkSync(PID_FILE); } catch { /* already gone */ }
    process.stdout.write('PID-based cleanup done.\n');
  } else {
    process.stdout.write('No PID file found. Killing by pattern...\n');
    const host = detectHost();
    const killCmd = host.os === 'wsl' ? 'sudo' : 'pkexec';

    // Tunnel runs as root
    try {
      const pids = execFileSync('pgrep', ['-f', 'pymobiledevice3.*start-tunnel'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (pids) {
        for (const p of pids.split('\n')) {
          try { execFileSync(killCmd, ['kill', '-9', p.trim()], { stdio: 'pipe' }); } catch { /* ignore */ }
        }
      }
    } catch { /* none running */ }

    try { execFileSync('pkill', ['-f', 'XCUITestService'], { stdio: 'pipe' }); } catch { /* ignore */ }
    try { execFileSync('fuser', ['-k', '8100/tcp'], { stdio: 'pipe' }); } catch { /* ignore */ }
    process.stdout.write('Pattern-based cleanup done.\n');
  }

  // Verify
  let remaining = 0;
  try {
    const out = execFileSync('pgrep', ['-f', 'pymobiledevice3.*(start-tunnel|forward 8100)|XCUITestService'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    remaining = out.trim().split('\n').filter(Boolean).length;
  } catch { /* none found = good */ }

  if (remaining === 0) {
    process.stdout.write('All iOS processes stopped.\n');
  } else {
    process.stderr.write(`${remaining} processes still running — may need manual cleanup.\n`);
  }
}

/**
 * Non-interactive WDA restart for auto-recovery.
 * Two-tier: first tries WDA-only restart (if tunnel is alive), then full restart.
 * @param {function} [log] — optional log callback
 * @returns {Promise<{baseUrl: string}>}
 */
export async function restartWda(log = () => {}) {
  const host = detectHost();
  const pids = loadPids();

  // Tier 1: WDA-only restart if tunnel alive and RSD stored
  if (pids && pids.rsdAddr && pids.rsdPort) {
    let tunnelAlive = false;
    try {
      process.kill(pids.tunnel, 0);
      tunnelAlive = true; // we own it (shouldn't happen — tunnel is root)
    } catch (err) {
      // EPERM = alive but root-owned (expected), ESRCH = dead
      if (err.code === 'EPERM') tunnelAlive = true;
    }

    if (tunnelAlive) {
      log('Tunnel alive — restarting WDA only...');
      // Kill WDA and forward
      try { process.kill(pids.wda, 'SIGKILL'); } catch { /* already dead */ }
      try { process.kill(pids.fwd, 'SIGKILL'); } catch { /* already dead */ }
      try { execFileSync('fuser', ['-k', '8100/tcp'], { stdio: 'pipe' }); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 500));

      const bundle = findWdaBundle();
      const py = findPython();
      if (bundle && py) {
        const wdaChild = spawn(py, ['-c', `
import asyncio
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.testmanaged.xcuitest import XCUITestService
async def main():
    rsd = RemoteServiceDiscoveryService(('${pids.rsdAddr}', ${pids.rsdPort}))
    await rsd.connect()
    XCUITestService(rsd).run('${bundle}')
asyncio.run(main())
`], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        wdaChild.stdout.on('data', () => {});
        wdaChild.stderr.on('data', () => {});

        // Re-forward via usbmux
        const device = await findUsbDevice();
        if (device) {
          const { forward } = await import('./usbmux.js');
          let fwdServer;
          try {
            fwdServer = await forward(device.deviceId, 8100, 8100);
          } catch (err) {
            log(`Port forward failed: ${err.message}`);
          }

          // Poll /status
          let ready = false;
          for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
              const res = await fetch('http://localhost:8100/status', { signal: AbortSignal.timeout(3000) });
              const status = await res.json();
              if (status.value?.ready) { ready = true; break; }
            } catch { /* retry */ }
          }

          if (ready) {
            savePids(pids.tunnel, wdaChild.pid, process.pid, pids.rsdAddr, pids.rsdPort);
            wdaChild.stdout.unref();
            wdaChild.stderr.unref();
            wdaChild.unref();
            if (fwdServer) fwdServer.unref();
            log('WDA restarted (tier-1, no pkexec)');
            return { baseUrl: 'http://localhost:8100' };
          }
        }
        // Tier-1 failed — kill spawned WDA before falling through
        try { wdaChild.kill(); } catch { /* ignore */ }
      }
    }

    // Tier-1 failed or not possible — kill everything for full restart
    log('Tier-1 failed — doing full restart...');
    const killCmd = host.os === 'wsl' ? 'sudo' : host.os === 'macos' ? 'sudo' : 'pkexec';
    try { execFileSync(killCmd, ['kill', '-9', String(pids.tunnel)], { stdio: 'pipe' }); } catch { /* ignore */ }
    try { process.kill(pids.wda, 'SIGKILL'); } catch { /* ignore */ }
    try { process.kill(pids.fwd, 'SIGKILL'); } catch { /* ignore */ }
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  }

  // Also kill by pattern
  try { execFileSync('pkill', ['-f', 'pymobiledevice3.*start-tunnel'], { stdio: 'pipe' }); } catch { /* ignore */ }
  try { execFileSync('pkill', ['-f', 'XCUITestService'], { stdio: 'pipe' }); } catch { /* ignore */ }
  try { execFileSync('fuser', ['-k', '8100/tcp'], { stdio: 'pipe' }); } catch { /* ignore */ }
  await new Promise(r => setTimeout(r, 500));

  // Tier 2: Full restart — tunnel + DDI + WDA + forward
  const device = await findUsbDevice();
  if (!device) throw new Error('No USB device found. Reconnect iPhone.');

  // Start tunnel
  log('Starting tunnel...');
  const pmd3Path = which('pymobiledevice3');
  if (!pmd3Path) throw new Error('pymobiledevice3 not in PATH');

  let tunnelChild;
  if (host.os === 'macos') {
    if (which('xcrun')) {
      tunnelChild = spawn('xcrun', ['devicectl', 'device', 'tunnel', '--udid', device.serial], {
        stdio: ['pipe', 'pipe', 'pipe'], detached: true,
      });
    } else {
      tunnelChild = spawn('sudo', ['pymobiledevice3', 'lockdown', 'start-tunnel'], {
        stdio: ['pipe', 'pipe', 'pipe'], detached: true,
      });
    }
  } else if (host.os === 'wsl') {
    tunnelChild = spawn('sudo', ['pymobiledevice3', 'lockdown', 'start-tunnel'], {
      stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    });
  } else {
    const py = findPython();
    const envArgs = [];
    if (py) {
      try {
        const sp = execFileSync(py, ['-c', 'import site; print(site.getusersitepackages())'], {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (sp) envArgs.push('env', `PYTHONPATH=${sp}`);
      } catch { /* best effort */ }
    }
    tunnelChild = spawn('pkexec', [...envArgs, pmd3Path, 'lockdown', 'start-tunnel'], {
      stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    });
  }

  let tunnelOutput;
  try {
    tunnelOutput = await waitForOutput(tunnelChild, /RSD Port:\s*\d+/i, 20000);
  } catch (err) {
    try { tunnelChild.kill(); } catch { /* ignore */ }
    throw new Error(`Tunnel failed: ${err.message}`);
  }

  const rsd = parseTunnelOutput(tunnelOutput);
  if (!rsd) {
    try { tunnelChild.kill(); } catch { /* ignore */ }
    throw new Error('Could not parse RSD address/port from tunnel output');
  }
  log(`Tunnel up: ${rsd.rsdAddr}:${rsd.rsdPort}`);

  // Mount DDI
  log('Mounting DDI...');
  try {
    pmd3(['mounter', 'auto-mount', '--rsd', rsd.rsdAddr, rsd.rsdPort]);
  } catch (err) {
    if (!err.message?.includes('already') && !err.stderr?.includes('already')) {
      log(`DDI mount warning: ${err.message}`);
    }
  }

  // Launch WDA
  log('Launching WDA...');
  const bundle = findWdaBundle();
  if (!bundle) throw new Error('WDA not installed on device');
  const py = findPython();
  if (!py) throw new Error('No Python with pymobiledevice3 found');

  const wdaChild = spawn(py, ['-c', `
import asyncio
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.testmanaged.xcuitest import XCUITestService
async def main():
    rsd = RemoteServiceDiscoveryService(('${rsd.rsdAddr}', ${rsd.rsdPort}))
    await rsd.connect()
    XCUITestService(rsd).run('${bundle}')
asyncio.run(main())
`], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  wdaChild.stdout.on('data', () => {});
  wdaChild.stderr.on('data', () => {});

  // Port forward + verify
  log('Verifying WDA...');
  const { forward } = await import('./usbmux.js');
  let fwdServer;
  try {
    fwdServer = await forward(device.deviceId, 8100, 8100);
  } catch (err) {
    throw new Error(`Port forward failed: ${err.message}`);
  }

  let ready = false;
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch('http://localhost:8100/status', { signal: AbortSignal.timeout(3000) });
      const status = await res.json();
      if (status.value?.ready) { ready = true; break; }
    } catch { /* retry */ }
  }

  if (!ready) {
    try { tunnelChild.kill(); } catch { /* ignore */ }
    try { wdaChild.kill(); } catch { /* ignore */ }
    if (fwdServer) fwdServer.close();
    throw new Error('WDA not responding after restart');
  }

  // Save PIDs and unref
  savePids(tunnelChild.pid, wdaChild.pid, process.pid, rsd.rsdAddr, rsd.rsdPort);
  tunnelChild.stdout.unref();
  tunnelChild.stderr.unref();
  tunnelChild.unref();
  wdaChild.stdout.unref();
  wdaChild.stderr.unref();
  wdaChild.unref();
  if (fwdServer) fwdServer.unref();

  log('WDA restarted successfully');
  return { baseUrl: 'http://localhost:8100' };
}
