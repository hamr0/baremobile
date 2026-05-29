// ADB transport — device discovery, command execution, XML dump

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { traceCall } from './debug.js';

const execAsync = promisify(execFile);

const DUMP_PATH = '/data/local/tmp/baremobile.xml';

/**
 * Run raw adb command. Threads `-s serial` if opts.serial set.
 * @param {string[]} args
 * @param {{serial?: string, timeout?: number, encoding?: BufferEncoding | 'buffer'}} [opts]
 * @returns {Promise<string>} stdout
 */
export async function exec(args, opts = {}) {
  const cmd = opts.serial ? ['-s', opts.serial, ...args] : args;
  /** @type {{ timeout: number, maxBuffer: number, encoding?: BufferEncoding | 'buffer' }} */
  const execOpts = {
    timeout: opts.timeout ?? 10_000,
    maxBuffer: 4 * 1024 * 1024,
  };
  if (opts.encoding !== undefined) execOpts.encoding = opts.encoding;
  // Cast to the base options type so tsc picks the string-returning execFile
  // overload; `encoding: 'buffer'` (used by screenshot) still applies at runtime.
  const { stdout } = await traceCall('adb', cmd,
    () => execAsync('adb', cmd, /** @type {import('node:child_process').ExecFileOptions} */ (execOpts)));
  // The encoding overload widens stdout to string|Buffer; non-buffer callers get
  // a string, and the lone buffer caller (screenshot) reads it as a Buffer anyway.
  return /** @type {string} */ (stdout);
}

/**
 * Run adb shell command.
 * @param {string} cmd — shell command string
 * @param {{serial?: string, timeout?: number}} [opts]
 * @returns {Promise<string>}
 */
export async function shell(cmd, opts = {}) {
  return exec(['shell', cmd], opts);
}

/**
 * Quote a value for safe inclusion in an `adb shell` command string.
 * `adb shell <cmd>` re-parses the string on the device, so any user-controlled
 * value flowing into a shell-string callsite must be quoted. Wraps in single
 * quotes and escapes embedded single quotes via the standard `'\''` idiom.
 *
 * @param {string|number|boolean} v
 * @returns {string} quoted token, e.g. `'O'\''Brien'`
 */
export function shellQuote(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

/**
 * Validate an Android package name. Package names must start with a letter
 * and contain only letters, digits, underscores, and dots — matching the
 * Java package convention enforced by the Android build system.
 *
 * Throws on invalid input so callers cannot accidentally pass attacker-
 * controlled strings into `am start … <pkg>` (which re-parses on the device).
 *
 * @param {string} pkg
 * @returns {string} the validated package name (returned for chaining)
 */
export function validatePackage(pkg) {
  if (typeof pkg !== 'string' || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(pkg)) {
    throw new Error(`Invalid Android package name: ${JSON.stringify(pkg)}`);
  }
  return pkg;
}

/**
 * Validate an Android intent action string. Actions are dotted identifiers
 * like `android.intent.action.VIEW` — same character class as package names
 * but additionally allowing the leading letter rule across each dotted part.
 *
 * @param {string} action
 * @returns {string} the validated action
 */
export function validateIntentAction(action) {
  if (typeof action !== 'string' || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(action)) {
    throw new Error(`Invalid intent action: ${JSON.stringify(action)}`);
  }
  return action;
}

/**
 * Validate an intent extra key. Same constraints as a Java identifier:
 * letters, digits, underscore, dot — no shell metacharacters.
 *
 * @param {string} key
 * @returns {string} the validated key
 */
export function validateExtraKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(key)) {
    throw new Error(`Invalid intent extra key: ${JSON.stringify(key)}`);
  }
  return key;
}

/**
 * List connected devices (state === 'device' only).
 * @returns {Promise<{serial: string, state: string, type: string}[]>}
 */
export async function listDevices() {
  const out = await exec(['devices', '-l']);
  const lines = out.split('\n').slice(1); // skip "List of devices attached"
  const devices = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const serial = parts[0];
    const state = parts[1];
    if (state !== 'device') continue;
    // type: "usb", "emulator", or "wifi" — infer from serial
    const type = serial.startsWith('emulator-') ? 'emulator'
      : /^\d+\.\d+\.\d+\.\d+:\d+$/.test(serial) ? 'wifi'
      : 'usb';
    devices.push({ serial, state, type });
  }
  return devices;
}

/**
 * Get screen dimensions via `wm size`.
 * @param {{serial?: string}} [opts]
 * @returns {Promise<{width: number, height: number}>}
 */
export async function screenSize(opts = {}) {
  const out = await shell('wm size', opts);
  const m = out.match(/(\d+)x(\d+)/);
  if (!m) throw new Error('Failed to parse screen size: ' + out.trim());
  return { width: +m[1], height: +m[2] };
}

/**
 * Dump UI hierarchy XML via uiautomator.
 * Uses dump-to-file + cat pattern (exec-out for binary-safe stdout).
 * @param {{serial?: string}} [opts]
 * @returns {Promise<string>} XML string
 */
export async function dumpXml(opts = {}) {
  const stdout = await exec(
    ['exec-out', `uiautomator dump ${DUMP_PATH} >/dev/null 2>&1; cat ${DUMP_PATH}`],
    { ...opts, timeout: 15_000 },
  );
  const xmlStart = stdout.indexOf('<?xml');
  if (xmlStart === -1) throw new Error('No XML in uiautomator output:\n' + stdout.slice(0, 200));
  return stdout.slice(xmlStart);
}
