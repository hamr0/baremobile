/**
 * Typed errors for baremobile. Classifying failures lets MCP retry tiers,
 * library callers, and tests react without parsing error messages — string
 * matching against `err.message` is fragile and breaks across runtime
 * versions.
 *
 * Each class sets `.name` (so `err.name === 'ElementNotFound'` works), a
 * stable `.code` matching the class name (for JSON serialisation), and
 * preserves the original cause when wrapping.
 *
 * Add new classes here as new failure categories surface — do NOT throw
 * generic `new Error(...)` from public APIs.
 */

class BaremobileError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown, code?: string}} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = opts.code ?? this.constructor.name;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/** A snapshot ref that doesn't resolve to a known element. */
export class ElementNotFound extends BaremobileError {
  constructor(ref, opts) {
    super(`No element with ref "${ref}". Snapshot may be stale — call snapshot() again.`, opts);
    this.ref = ref;
  }
}

/** A selector ({text}, {contentDesc}) that didn't match any element. */
export class SelectorNotFound extends BaremobileError {
  constructor(selector, opts) {
    super(`No element matched selector ${JSON.stringify(selector)}.`, opts);
    this.selector = selector;
  }
}

/** WDA HTTP didn't respond inside the timeout window. */
export class WdaTimeout extends BaremobileError {
  constructor(path, timeoutMs, opts) {
    super(`WDA request timed out after ${timeoutMs}ms: ${path}`, opts);
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

/** WDA was not reachable (connection refused, reset, fetch failed). */
export class WdaUnavailable extends BaremobileError {
  constructor(baseUrl, opts) {
    super(`WDA not reachable at ${baseUrl}.`, opts);
    this.baseUrl = baseUrl;
  }
}

/** A wait-* loop exceeded its timeout. */
export class WaitTimeout extends BaremobileError {
  constructor(what, timeoutMs, opts) {
    super(`Timed out after ${timeoutMs}ms waiting for ${what}.`, opts);
    this.what = what;
    this.timeoutMs = timeoutMs;
  }
}

/** Input failed validation (bad package, bad selector shape, malformed arg). */
export class InvalidArgument extends BaremobileError {
  constructor(message, opts) {
    super(message, opts);
  }
}

/** Catch-all device-side failure (ADB, usbmuxd, signing). */
export class DeviceError extends BaremobileError {
  constructor(message, opts) {
    super(message, opts);
  }
}

/**
 * Discriminator helper for the MCP retry layer — any error here means
 * "try again after clearing the cached page". Centralised so MCP doesn't
 * need to enumerate every connection-shaped error code by hand.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isConnectionError(err) {
  const code = err?.code;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') return true;
  if (code === 'WdaTimeout' || code === 'WdaUnavailable' || code === 'WDA_TIMEOUT') return true;
  const msg = err?.message || '';
  // Fallback for errors we haven't typed yet (third-party fetch failures).
  return msg.includes('fetch failed') || msg.includes('ECONNREFUSED')
    || msg.includes('ECONNRESET') || msg.includes('UND_ERR');
}
