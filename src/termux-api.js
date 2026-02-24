// Termux:API — direct Android API access without ADB
// Requires: Termux + Termux:API addon (pkg install termux-api)
// All commands return parsed JSON or trimmed strings.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);

const TIMEOUT = 15_000;

/**
 * Run a termux-* command, return stdout.
 * @param {string} cmd — command name (e.g. 'termux-battery-status')
 * @param {string[]} [args]
 * @param {{timeout?: number, input?: string}} [opts]
 * @returns {Promise<string>}
 */
async function run(cmd, args = [], opts = {}) {
  const execOpts = { timeout: opts.timeout ?? TIMEOUT, maxBuffer: 1024 * 1024 };
  if (opts.input !== undefined) {
    // pipe input via stdin
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, args, execOpts, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
      child.stdin.write(opts.input);
      child.stdin.end();
    });
  }
  const { stdout } = await execAsync(cmd, args, execOpts);
  return stdout;
}

/**
 * Run a termux-* command that returns JSON.
 * @param {string} cmd
 * @param {string[]} [args]
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<object>}
 */
async function runJSON(cmd, args = [], opts = {}) {
  const out = await run(cmd, args, opts);
  return JSON.parse(out);
}

// --- Detection ---

/**
 * Check if Termux:API is available.
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  try {
    await execAsync('which', ['termux-battery-status'], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

// --- Battery & System ---

/**
 * Get battery status.
 * @returns {Promise<{health: string, percentage: number, plugged: string, status: string, temperature: number}>}
 */
export async function batteryStatus() {
  return runJSON('termux-battery-status');
}

// --- Clipboard ---

/**
 * Get clipboard contents.
 * @returns {Promise<string>}
 */
export async function clipboardGet() {
  const out = await run('termux-clipboard-get');
  return out;
}

/**
 * Set clipboard contents.
 * @param {string} text
 */
export async function clipboardSet(text) {
  await run('termux-clipboard-set', [], { input: text });
}

// --- SMS ---

/**
 * Send an SMS.
 * @param {string} number — recipient phone number
 * @param {string} text — message body
 * @param {{slot?: number}} [opts]
 */
export async function smsSend(number, text, opts = {}) {
  const args = ['-n', number];
  if (opts.slot !== undefined) args.push('-s', String(opts.slot));
  await run('termux-sms-send', args, { input: text });
}

/**
 * List SMS messages.
 * @param {{limit?: number, offset?: number, type?: 'all'|'inbox'|'sent'|'draft'|'outbox'}} [opts]
 * @returns {Promise<object[]>}
 */
export async function smsList(opts = {}) {
  const args = [];
  if (opts.limit !== undefined) args.push('-l', String(opts.limit));
  if (opts.offset !== undefined) args.push('-o', String(opts.offset));
  if (opts.type) args.push('-t', opts.type);
  return runJSON('termux-sms-list', args);
}

// --- Telephony ---

/**
 * Make a phone call.
 * @param {string} number
 */
export async function call(number) {
  await run('termux-telephony-call', [number]);
}

// --- Location ---

/**
 * Get device location.
 * @param {{provider?: 'gps'|'network'|'passive', request?: 'once'|'last'}} [opts]
 * @returns {Promise<{latitude: number, longitude: number, altitude: number, accuracy: number, bearing: number, speed: number}>}
 */
export async function location(opts = {}) {
  const args = [];
  if (opts.provider) args.push('-p', opts.provider);
  if (opts.request) args.push('-r', opts.request);
  return runJSON('termux-location', args, { timeout: 30_000 });
}

// --- Camera ---

/**
 * Take a photo.
 * @param {string} outputFile — path to save JPEG
 * @param {{camera?: number}} [opts]
 */
export async function cameraPhoto(outputFile, opts = {}) {
  const args = [];
  if (opts.camera !== undefined) args.push('-c', String(opts.camera));
  args.push(outputFile);
  await run('termux-camera-photo', args, { timeout: 30_000 });
}

// --- Contacts ---

/**
 * List all contacts.
 * @returns {Promise<{name: string, number: string}[]>}
 */
export async function contactList() {
  return runJSON('termux-contact-list');
}

// --- Notifications ---

/**
 * Show a notification.
 * @param {string} title
 * @param {string} content
 * @param {{id?: string, ongoing?: boolean, sound?: boolean, priority?: 'high'|'low'|'max'|'min'|'default'}} [opts]
 */
export async function notify(title, content, opts = {}) {
  const args = ['-t', title, '-c', content];
  if (opts.id) args.push('-i', opts.id);
  if (opts.ongoing) args.push('--ongoing');
  if (opts.sound) args.push('--sound');
  if (opts.priority) args.push('--priority', opts.priority);
  await run('termux-notification', args);
}

// --- Volume ---

/**
 * Get volume info for all streams.
 * @returns {Promise<{stream: string, volume: number, max_volume: number}[]>}
 */
export async function volumeGet() {
  return runJSON('termux-volume');
}

/**
 * Set volume for a stream.
 * @param {'alarm'|'music'|'notification'|'ring'|'system'|'call'} stream
 * @param {number} volume
 */
export async function volumeSet(stream, volume) {
  await run('termux-volume', [stream, String(volume)]);
}

// --- WiFi ---

/**
 * Get WiFi connection info.
 * @returns {Promise<object>}
 */
export async function wifiInfo() {
  return runJSON('termux-wifi-connectioninfo');
}

// --- Torch ---

/**
 * Toggle flashlight.
 * @param {boolean} on
 */
export async function torch(on) {
  await run('termux-torch', [on ? 'on' : 'off']);
}

// --- Vibrate ---

/**
 * Vibrate the device.
 * @param {{duration?: number, force?: boolean}} [opts] — duration in ms (default 1000)
 */
export async function vibrate(opts = {}) {
  const args = [];
  if (opts.duration !== undefined) args.push('-d', String(opts.duration));
  if (opts.force) args.push('-f');
  await run('termux-vibrate', args);
}
