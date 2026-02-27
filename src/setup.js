// Unified setup wizard for baremobile.
// All setup logic lives here — cli.js is thin routing.

import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const PID_FILE = '/tmp/baremobile-ios-pids';

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
    const onData = (d) => {
      output += d.toString();
      const m = output.match(regex);
      if (m) {
        clearTimeout(timer);
        resolve(output);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${regex} (got: ${output.slice(0, 200)})`));
    }, timeoutMs);
  });
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

function savePids(tunnelPid, wdaPid, fwdPid) {
  writeFileSync(PID_FILE, `${tunnelPid} ${wdaPid} ${fwdPid}`);
}

function loadPids() {
  try {
    const raw = readFileSync(PID_FILE, 'utf8').trim();
    const [tunnel, wda, fwd] = raw.split(/\s+/).map(Number);
    return { tunnel, wda, fwd };
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
 * Android setup wizard — 2 steps.
 */
export async function setupAndroid(ui) {
  ui.write('\n--- Android Setup ---\n\n');

  // Step 1: Check adb
  ui.step(1, 'Checking adb');
  try {
    execFileSync('adb', ['version'], { stdio: 'pipe' });
    ui.ok('adb found');
  } catch {
    ui.fail('adb NOT FOUND');
    ui.write('   Install Android SDK platform-tools: https://developer.android.com/tools/releases/platform-tools\n');
    ui.write('   Then add to PATH and re-run setup.\n');
    return;
  }

  // Step 2: Check device
  ui.step(2, 'Checking connected devices');
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8' });
    const lines = out.split('\n').filter(l => l.includes('\tdevice'));
    if (lines.length > 0) {
      ui.ok(`${lines.length} device(s) found`);
      for (const line of lines) {
        ui.write(`   ${line.split('\t')[0]}\n`);
      }
    } else {
      ui.warn('No devices found');
      ui.write('   Enable USB debugging on your device:\n');
      ui.write('   Settings > About phone > tap "Build number" 7 times\n');
      ui.write('   Settings > Developer options > USB debugging > ON\n');
      ui.write('   Connect USB cable and tap "Allow" on the debugging prompt.\n');
      await ui.waitForEnter('Once connected');
      const out2 = execFileSync('adb', ['devices'], { encoding: 'utf8' });
      const lines2 = out2.split('\n').filter(l => l.includes('\tdevice'));
      if (lines2.length > 0) {
        ui.ok(`${lines2.length} device(s) found`);
      } else {
        ui.fail('Still no device. Check connection and try again.');
        return;
      }
    }
  } catch (err) {
    ui.fail(`Error: ${err.message}`);
    return;
  }

  ui.write('\nAndroid setup complete. Run: baremobile open\n');
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

  // Step 6: Check Developer Mode
  ui.step(6, 'Checking Developer Mode');
  try {
    const out = pmd3(['mounter', 'query-developer-mode-status']);
    if (out.includes('true')) {
      ui.ok('Developer Mode enabled');
    } else {
      ui.warn('Developer Mode may be OFF');
      ui.write('   Enable: Settings > Privacy & Security > Developer Mode > ON\n');
      ui.write('   (Requires device restart)\n');
      await ui.waitForEnter('Once enabled');
    }
  } catch {
    ui.warn('Could not check Developer Mode (enable it manually)');
    ui.write('   Settings > Privacy & Security > Developer Mode > ON\n');
    await ui.waitForEnter('Once enabled');
  }

  // Step 7: Check UI Automation
  ui.step(7, 'UI Automation');
  ui.write('   Verify: Settings > Developer > Enable UI Automation is ON\n');
  await ui.waitForEnter('Once verified');
  ui.ok('UI Automation confirmed by user');

  // Step 8: Sign & install WDA
  ui.step(8, 'Checking WDA installation');
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
    const email = await ui.prompt('Apple ID email: ');
    if (!email) { ui.fail('Email required.'); return; }
    const password = await ui.prompt('Apple ID password: ');
    if (!password) { ui.fail('Password required.'); return; }

    ui.write('Starting AltServer...\n');
    const child = spawn(altserver, [
      '-u', device.serial,
      '-a', email, '-p', password, wdaIpa,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    child.stdout.on('data', (d) => ui.write(d.toString()));
    child.stderr.on('data', (d) => ui.write(d.toString()));

    const twoFa = await ui.prompt('Enter 2FA code from your phone: ');
    if (twoFa) child.stdin.write(twoFa + '\n');

    const exitCode = await new Promise((r) => child.on('close', r));
    if (exitCode !== 0) {
      ui.fail(`AltServer exited with code ${exitCode}`);
      return;
    }
    const { recordIosSigning } = await import('./ios-cert.js');
    recordIosSigning();
    ui.ok('WDA signed and installed');
    ui.write('   Trust the developer profile on your device:\n');
    ui.write('   Settings > General > VPN & Device Management > trust your Apple ID\n');
    await ui.waitForEnter('Once trusted');
  }

  // Step 9: Start WDA server
  ui.step(9, 'Starting WDA server');
  await startWda(ui, '9');

  // Step 10: Verify
  ui.step(10, 'Final verification');
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
  const device = await findUsbDevice();
  if (!device) {
    ui.fail('No USB device connected. Connect iPhone first.');
    return;
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
    ui.fail(`Tunnel failed: ${err.message}`);
    try { tunnelChild.kill(); } catch { /* ignore */ }
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

  wdaChild.stdout.on('data', (d) => ui.write(d.toString()));
  wdaChild.stderr.on('data', (d) => ui.write(d.toString()));
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
  savePids(tunnelChild.pid, wdaChild.pid, process.pid);

  // Unref so parent can exit without killing children
  tunnelChild.unref();
  wdaChild.unref();

  if (wdaReady) {
    ui.ok('WDA ready at http://localhost:8100');
    ui.write(`\n  Tunnel PID: ${tunnelChild.pid}\n`);
    ui.write(`  WDA PID:    ${wdaChild.pid}\n`);
    ui.write(`  PIDs saved to ${PID_FILE}\n`);
    ui.write(`  To stop: baremobile ios teardown\n\n`);
  } else {
    ui.fail('WDA not responding after 3 attempts');
    ui.write('   Common fix: trust developer profile on device\n');
    ui.write('   Settings > General > VPN & Device Management > Trust\n');
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
  const device = await findUsbDevice();
  if (!device) {
    ui.fail('No USB device connected. Connect iPhone first.');
    return;
  }
  ui.ok(`Device: ${device.serial}`);

  // Step 3: Sign
  ui.step(3, 'Signing WDA');
  const email = await ui.prompt('Apple ID email: ');
  if (!email) { ui.fail('Email required.'); return; }
  const password = await ui.prompt('Apple ID password: ');
  if (!password) { ui.fail('Password required.'); return; }

  const wdaIpa = resolve('.wda/WebDriverAgent.ipa');
  ui.write('Starting AltServer...\n');
  const child = spawn(altserver, [
    '-u', device.serial,
    '-a', email, '-p', password, wdaIpa,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  child.stdout.on('data', (d) => ui.write(d.toString()));
  child.stderr.on('data', (d) => ui.write(d.toString()));

  const twoFa = await ui.prompt('Enter 2FA code from your phone: ');
  if (twoFa) child.stdin.write(twoFa + '\n');

  const exitCode = await new Promise((r) => child.on('close', r));
  if (exitCode !== 0) {
    ui.fail(`AltServer exited with code ${exitCode}. Check output above.`);
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
