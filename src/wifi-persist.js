// WiFi device persistence — save/load last known WiFi device IP for auto-reconnect.

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const CONFIG_DIR = join(homedir(), '.config', 'baremobile');
const DEVICE_FILE = join(CONFIG_DIR, 'wifi-device.json');

// IPv4 only — the rest of the code paths (`adb connect ip:port`, subnet scan)
// assume IPv4 numeric octets. We deliberately do not accept v6 or hostnames
// to keep validation simple and defense-in-depth tight.
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Validate an IPv4 address string. Used to gate saved-device loading so a
 * corrupted ~/.config/baremobile/wifi-device.json can't push attacker-
 * controlled bytes into adb connect or subnet scan paths.
 */
export function isValidIpv4(s) {
  return typeof s === 'string' && IPV4_RE.test(s);
}

/**
 * Save WiFi device IP after successful setup.
 * @param {string} ip
 * @param {number} [port=5555]
 */
export function saveDevice(ip, port = 5555) {
  try { mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
  writeFileSync(DEVICE_FILE, JSON.stringify({ ip, port, saved: Date.now() }));
}

/**
 * Load saved WiFi device info. Returns null and deletes the file if the
 * stored record is corrupt (bad JSON, missing fields, malformed IP, or
 * non-numeric port). This stops a poisoned config from feeding garbage
 * into `adb connect` or the subnet scanner downstream.
 *
 * @returns {{ ip: string, port: number } | null}
 */
export function loadSavedDevice() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(DEVICE_FILE, 'utf8'));
  } catch { return null; }

  const port = Number(parsed?.port);
  if (!isValidIpv4(parsed?.ip) || !Number.isInteger(port) || port < 1 || port > 65535) {
    try { unlinkSync(DEVICE_FILE); } catch { /* file may already be gone */ }
    return null;
  }
  return { ip: parsed.ip, port };
}

/**
 * Try to reconnect to a saved WiFi device.
 * Scans the local subnet if saved IP fails (handles DHCP reassignment).
 * @param {{ ip: string, port: number }} saved
 */
export async function reconnectWifi(saved) {
  const { port } = saved;

  // Try saved IP first
  if (tryConnect(saved.ip, port)) {
    return;
  }

  // Saved IP failed — scan subnet for the device
  const subnet = saved.ip.replace(/\.\d+$/, '');
  const found = scanSubnet(subnet, port);
  if (found) {
    // Update saved IP for next time
    saveDevice(found, port);
  }
}

/**
 * Try `adb connect ip:port`. Returns true if successful.
 */
function tryConnect(ip, port) {
  try {
    const out = execFileSync('adb', ['connect', `${ip}:${port}`], {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return /connected/.test(out) && !/refused|failed|unable/i.test(out);
  } catch { return false; }
}

/**
 * Scan common DHCP range on subnet for an ADB device.
 * Tries a quick ping sweep then adb connect on responders.
 * @returns {string|null} IP that connected, or null
 */
function scanSubnet(subnet, port) {
  // Try fast methods first (arp/nmap), fall back to ping sweep
  try {
    const candidates = [];

    // Tier 1: arp cache — instant, already-known hosts
    try {
      execFileSync('arp', ['-a'], { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] })
        .match(/\d+\.\d+\.\d+\.\d+/g)
        ?.filter(ip => ip.startsWith(subnet + '.'))
        .forEach(ip => candidates.push(ip));
    } catch { /* arp not available */ }

    // Tier 2: nmap ping scan — fast subnet discovery
    if (candidates.length === 0) {
      try {
        execFileSync('nmap', ['-sn', '-n', `${subnet}.0/24`], {
          encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
        }).match(/\d+\.\d+\.\d+\.\d+/g)
          ?.filter(ip => ip.startsWith(subnet + '.'))
          .forEach(ip => candidates.push(ip));
      } catch { /* nmap not available */ }
    }

    // Tier 3: parallel ping sweep (slowest fallback)
    if (candidates.length === 0) {
      try {
        execFileSync('sh', ['-c',
          `for i in $(seq 1 254); do (ping -c1 -W1 ${subnet}.$i >/dev/null 2>&1 && echo ${subnet}.$i) & done | head -20; wait`
        ], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] })
          .trim().split('\n').filter(Boolean).forEach(ip => candidates.push(ip));
      } catch {
        // All scan methods failed — try common DHCP range directly
        for (let i = 2; i <= 100; i++) candidates.push(`${subnet}.${i}`);
      }
    }

    for (const ip of candidates) {
      if (tryConnect(ip, port)) return ip;
    }
  } catch {}
  return null;
}
