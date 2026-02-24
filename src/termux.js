// Termux transport — detect Termux environment, connect to localhost ADB

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';

const execAsync = promisify(execFile);

/**
 * Detect if running inside Termux.
 * Checks TERMUX_VERSION env var, then /data/data/com.termux existence.
 * @returns {Promise<boolean>}
 */
export async function isTermux() {
  if (process.env.TERMUX_VERSION) return true;
  try {
    await access('/data/data/com.termux');
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan `adb devices` for localhost:* entries (wireless debugging connections).
 * @returns {Promise<string[]>} array of serial strings like "localhost:34567"
 */
export async function findLocalDevices() {
  const { stdout } = await execAsync('adb', ['devices'], { timeout: 5_000 });
  const lines = stdout.split('\n').slice(1); // skip "List of devices attached"
  const devices = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [serial, state] = trimmed.split(/\s+/);
    if (state === 'device' && serial.startsWith('localhost:')) {
      devices.push(serial);
    }
  }
  return devices;
}

/**
 * Pair with wireless debugging endpoint.
 * @param {number} port — pairing port (shown in wireless debugging UI)
 * @param {string} code — 6-digit pairing code
 * @returns {Promise<string>} adb pair output
 */
export async function adbPair(port, code) {
  const { stdout } = await execAsync('adb', ['pair', `localhost:${port}`, code], {
    timeout: 10_000,
  });
  return stdout.trim();
}

/**
 * Connect to wireless debugging port.
 * @param {number} port — connect port (different from pairing port)
 * @returns {Promise<string>} adb connect output
 */
export async function adbConnect(port) {
  const { stdout } = await execAsync('adb', ['connect', `localhost:${port}`], {
    timeout: 10_000,
  });
  return stdout.trim();
}

/**
 * Resolve a localhost ADB device for Termux use.
 * Checks for existing localhost connections first.
 * @returns {Promise<string>} serial string like "localhost:34567"
 * @throws {Error} with setup instructions if no device found
 */
export async function resolveTermuxDevice() {
  const devices = await findLocalDevices();
  if (devices.length > 0) return devices[0];

  throw new Error(
    'No localhost ADB device found.\n\n' +
    'To use baremobile in Termux:\n' +
    '1. Install android-tools: pkg install android-tools\n' +
    '2. Enable Wireless Debugging: Settings → Developer options → Wireless debugging\n' +
    '3. Tap "Pair device with pairing code" and note the port + code\n' +
    '4. Run: adb pair localhost:PORT CODE\n' +
    '5. Note the connect port (shown on the Wireless debugging screen)\n' +
    '6. Run: adb connect localhost:PORT\n' +
    '7. Verify: adb devices (should show localhost:PORT)\n\n' +
    'Note: Wireless debugging must be re-enabled after each reboot.'
  );
}
