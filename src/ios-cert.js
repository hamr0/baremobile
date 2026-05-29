// iOS WDA cert expiry tracking.
// Free Apple ID certs expire after 7 days. This module checks the signing
// timestamp and warns when re-signing is needed.

import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Per-user dir, not shared /tmp: a predictable world-writable /tmp path lets
// another local user pre-create/symlink it to redirect our write or suppress
// the expiry warning. Mirrors wifi-persist.js / ios.js's location choice.
const CONFIG_DIR = join(homedir(), '.config', 'baremobile');
const SIGNED_FILE = join(CONFIG_DIR, 'ios-signed');
const WARN_DAYS = 6;

export function checkIosCert() {
  try {
    const stat = statSync(SIGNED_FILE);
    const days = (Date.now() - stat.mtimeMs) / 86400000;
    if (days > WARN_DAYS) {
      return `WDA cert signed ${Math.floor(days)} days ago (expires at 7). Run: baremobile ios resign`;
    }
    return null;
  } catch {
    return null;
  }
}

export function recordIosSigning() {
  try { mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
  writeFileSync(SIGNED_FILE, new Date().toISOString());
}
