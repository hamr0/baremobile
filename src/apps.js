// Android app-management helpers — thin wrappers around `pm grant`,
// `pm revoke`, `pm clear`. Every package and permission flows through
// shellQuote / validatePackage so an attacker-controlled value can't
// escape the `adb shell` string.

import { shell, validatePackage } from './adb.js';
import { InvalidArgument } from './errors.js';

// Android permission names are dotted identifiers like
// `android.permission.CAMERA`. We accept the same character class as
// package names — anything outside that is a shell metacharacter.
const PERM_RE = /^[A-Za-z][A-Za-z0-9_.]*$/;

function validatePermission(perm) {
  if (typeof perm !== 'string' || !PERM_RE.test(perm)) {
    throw new InvalidArgument(`Invalid Android permission name: ${JSON.stringify(perm)}`);
  }
  return perm;
}

/**
 * Grant a single runtime permission. Returns the raw `pm grant` stdout,
 * or throws on validation failure.
 */
export async function grantPermission(pkg, perm, opts = {}) {
  validatePackage(pkg);
  validatePermission(perm);
  return shell(`pm grant ${pkg} ${perm}`, opts);
}

/**
 * Revoke a single runtime permission.
 */
export async function revokePermission(pkg, perm, opts = {}) {
  validatePackage(pkg);
  validatePermission(perm);
  return shell(`pm revoke ${pkg} ${perm}`, opts);
}

/**
 * Wipe an app's `/data/data/<pkg>` — sign-out, force a fresh first-run.
 */
export async function clearAppData(pkg, opts = {}) {
  validatePackage(pkg);
  return shell(`pm clear ${pkg}`, opts);
}

/**
 * List the runtime permissions an app currently holds. Returns an array
 * of permission names. Parses `dumpsys package <pkg>` rather than `pm
 * list`, because dumpsys gives us granted/denied state per permission.
 */
export async function listPermissions(pkg, opts = {}) {
  validatePackage(pkg);
  const out = await shell(`dumpsys package ${pkg}`, opts);
  const granted = [];
  // Look for lines like `android.permission.CAMERA: granted=true`
  const re = /(android\.permission\.[A-Z_]+):\s*granted=true/g;
  let m;
  while ((m = re.exec(out)) !== null) granted.push(m[1]);
  return [...new Set(granted)];
}
