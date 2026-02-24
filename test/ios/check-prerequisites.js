#!/usr/bin/env node

/**
 * iOS spike prerequisite checker.
 * Validates that all required tools are installed and an iPhone is reachable.
 *
 * Run: node test/ios/check-prerequisites.js
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const PYTHON = 'python3.12';
const PMD3 = [PYTHON, '-m', 'pymobiledevice3'];

const checks = [
  {
    name: 'Python 3.12',
    cmd: [PYTHON, '--version'],
    parse: (out) => out.stdout.trim(),
  },
  {
    name: 'pymobiledevice3',
    cmd: [PYTHON, '-m', 'pymobiledevice3', 'version'],
    parse: (out) => out.stdout.trim() || out.stderr.trim(),
  },
  {
    name: 'usbmuxd running',
    cmd: ['systemctl', 'is-active', 'usbmuxd'],
    parse: (out) => out.stdout.trim(),
    expect: 'active',
    fixHint: 'Plug in iPhone via USB, or run: sudo usbmuxd -f -v',
  },
  {
    name: 'iPhone connected',
    cmd: [...PMD3, 'usbmux', 'list'],
    parse: (out) => {
      const devices = JSON.parse(out.stdout);
      if (devices.length === 0) return null;
      const d = devices[0];
      return `${d.DeviceName} (${d.ProductType}) iOS ${d.ProductVersion} via ${d.ConnectionType}`;
    },
    fixHint: 'Connect iPhone via USB and trust the computer',
  },
  {
    name: 'Developer Mode',
    cmd: [...PMD3, 'amfi', 'developer-mode-status'],
    parse: (out) => out.stdout.trim(),
    expect: 'true',
    fixHint: [
      'Run: python3.12 -m pymobiledevice3 amfi reveal-developer-mode',
      'Then: Settings > Privacy & Security > Developer Mode > ON > Restart',
    ].join('\n         '),
  },
];

let allPassed = true;

for (const check of checks) {
  try {
    const result = await exec(check.cmd[0], check.cmd.slice(1), { timeout: 10000 });
    const value = check.parse(result);

    if (!value || (check.expect && value !== check.expect)) {
      console.log(`  FAIL  ${check.name}: got "${value}"`);
      if (check.fixHint) console.log(`         ${check.fixHint}`);
      allPassed = false;
    } else {
      console.log(`  OK    ${check.name}: ${value}`);
    }
  } catch (err) {
    console.log(`  FAIL  ${check.name}: ${err.message.split('\n')[0]}`);
    if (check.fixHint) console.log(`         ${check.fixHint}`);
    allPassed = false;
  }
}

// tunneld check — separate because it queries a network service
try {
  const result = await exec(PMD3[0], [...PMD3.slice(1), 'remote', 'browse'], { timeout: 5000 });
  const tunnels = result.stdout.trim();
  if (tunnels) {
    console.log(`  OK    tunneld: reachable`);
  } else {
    console.log(`  WARN  tunneld: running but no tunnels found`);
  }
} catch {
  console.log(`  FAIL  tunneld: not running`);
  console.log(`         Run in separate terminal:`);
  console.log(`         sudo PYTHONPATH=$HOME/.local/lib/python3.12/site-packages python3.12 -m pymobiledevice3 remote tunneld`);
  allPassed = false;
}

console.log();
if (allPassed) {
  console.log('All iOS prerequisites met. Ready to spike.');
} else {
  console.log('Some prerequisites missing. Fix the above and re-run.');
  process.exit(1);
}
