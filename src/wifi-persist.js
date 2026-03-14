// WiFi device persistence — save/load last known WiFi device IP for auto-reconnect.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const CONFIG_DIR = join(homedir(), '.config', 'baremobile');
const DEVICE_FILE = join(CONFIG_DIR, 'wifi-device.json');

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
 * Load saved WiFi device info.
 * @returns {{ ip: string, port: number } | null}
 */
export function loadSavedDevice() {
  try {
    return JSON.parse(readFileSync(DEVICE_FILE, 'utf8'));
  } catch { return null; }
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
  // Quick parallel ping sweep (1 second timeout each, background)
  // Then try adb connect on IPs that responded
  try {
    // Use nmap if available for speed, fall back to sequential scan of common range
    const candidates = [];

    // Ping sweep — run in parallel via shell
    try {
      execFileSync('sh', ['-c',
        `for i in $(seq 1 254); do (ping -c1 -W1 ${subnet}.$i >/dev/null 2>&1 && echo ${subnet}.$i) & done | head -20; wait`
      ], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] })
        .trim().split('\n').filter(Boolean).forEach(ip => candidates.push(ip));
    } catch {
      // Ping sweep failed/timed out — try common DHCP range directly
      for (let i = 2; i <= 100; i++) candidates.push(`${subnet}.${i}`);
    }

    for (const ip of candidates) {
      if (tryConnect(ip, port)) return ip;
    }
  } catch {}
  return null;
}
