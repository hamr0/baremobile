// ADB transport — device discovery, command execution, XML dump

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);

const DUMP_PATH = '/data/local/tmp/baremobile.xml';

/**
 * Run raw adb command. Threads `-s serial` if opts.serial set.
 * @param {string[]} args
 * @param {{serial?: string, timeout?: number}} [opts]
 * @returns {Promise<string>} stdout
 */
export async function exec(args, opts = {}) {
  const cmd = opts.serial ? ['-s', opts.serial, ...args] : args;
  const execOpts = {
    timeout: opts.timeout ?? 10_000,
    maxBuffer: 4 * 1024 * 1024,
  };
  if (opts.encoding !== undefined) execOpts.encoding = opts.encoding;
  const { stdout } = await execAsync('adb', cmd, execOpts);
  return stdout;
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
    // type: "usb" or "emulator" — infer from serial
    const type = serial.startsWith('emulator-') ? 'emulator' : 'usb';
    devices.push({ serial, state, type });
  }
  return devices;
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
