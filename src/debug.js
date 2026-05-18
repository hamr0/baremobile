/**
 * Observability gate. Set DEBUG_BAREMOBILE=1 (or any truthy value) to
 * mirror every ADB / WDA / usbmuxd call to stderr with timings. Cheap
 * no-op when disabled — boils down to one boolean check per call.
 *
 * Usage:
 *   import { traceCall } from './debug.js';
 *   await traceCall('adb', ['shell', 'pm list packages'], () => execFile(...))
 *
 * Output (when enabled):
 *   [baremobile] adb [shell pm list packages]   ok  42ms
 *   [baremobile] wda POST /session/{sid}/element  err WdaTimeout 10001ms
 */

const DEBUG = !!process.env.DEBUG_BAREMOBILE
  && process.env.DEBUG_BAREMOBILE !== '0'
  && process.env.DEBUG_BAREMOBILE !== 'false';

export function isDebugEnabled() { return DEBUG; }

/**
 * Wrap an async call, tracing latency + outcome.
 * @template T
 * @param {string} channel — short tag (e.g. 'adb', 'wda', 'usbmux')
 * @param {string|string[]|object} label — what was called (free-form)
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function traceCall(channel, label, fn) {
  if (!DEBUG) return fn();
  const t0 = Date.now();
  const desc = Array.isArray(label) ? `[${label.join(' ')}]`
    : typeof label === 'string' ? label
    : JSON.stringify(label);
  try {
    const out = await fn();
    process.stderr.write(`[baremobile] ${channel} ${desc}  ok ${Date.now() - t0}ms\n`);
    return out;
  } catch (e) {
    const name = e?.name || 'Error';
    process.stderr.write(`[baremobile] ${channel} ${desc}  err ${name} ${Date.now() - t0}ms\n`);
    throw e;
  }
}
