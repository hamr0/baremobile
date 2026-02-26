// iOS WDA cert expiry tracking.
// Free Apple ID certs expire after 7 days. This module checks the signing
// timestamp and warns when re-signing is needed.

import { statSync, writeFileSync } from 'node:fs';

const SIGNED_FILE = '/tmp/baremobile-ios-signed';
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
    return 'No WDA signing record found. Run: baremobile ios resign';
  }
}

export function recordIosSigning() {
  writeFileSync(SIGNED_FILE, new Date().toISOString());
}
