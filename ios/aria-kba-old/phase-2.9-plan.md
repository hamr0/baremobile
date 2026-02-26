# Phase 2.9: iOS JavaScript Module

> Unified setup script → live speed test → `src/ios.js` module

All underlying capabilities proven in Phase 2.7 (pymobiledevice3) and 2.8 (BLE HID). This phase wraps them into a clean JS API.

---

## Three Sub-Phases

| # | Deliverable | What |
|---|------------|------|
| 2.9.1 | `scripts/ios-tunnel.sh` | Unified setup — one command starts USB tunnel + BLE HID |
| 2.9.2 | `scripts/ios-live-test.js` | Live speed test — measure real latency before building module |
| 2.9.3 | `src/ios.js` | JS module — `connect() → page` with screenshot, launch, tapXY, type |

---

## 2.9.1: Unified Setup Script

`./scripts/ios-tunnel.sh` — replaces the two-terminal workflow.

```bash
./scripts/ios-tunnel.sh          # starts tunnel + BLE HID, writes PID files
./scripts/ios-tunnel.sh stop     # tears down both
```

Behavior:
1. Check prerequisites (Python 3.12, pymobiledevice3, BlueZ, iPhone connected)
2. Start `pymobiledevice3 lockdown start-tunnel` in background
3. Parse RSD address from tunnel output, write to `/tmp/ios-rsd-address`
4. Start BLE HID GATT server (`ble-hid-poc.py`) in background
5. Write PIDs to `/tmp/ios-tunnel.pid` and `/tmp/ios-ble-hid.pid`
6. `stop` subcommand reads PIDs and kills both

---

## 2.9.2: Live Speed Test

`scripts/ios-live-test.js` — interactive test with real iPhone, measures latency.

| Measurement | Current | Target |
|-------------|---------|--------|
| Screenshot | ~2.5s | <1.5s |
| BLE tap at coordinates | ~1-2s | <500ms |
| BLE type string | ~200ms/char | <100ms/char |
| Screenshot → tap → screenshot loop | ~40s | <5s |

Speed strategies to validate:
- Persistent pymobiledevice3 connection (avoid per-call tunnel setup overhead)
- Pre-connected BLE HID (skip pairing overhead)
- Cursor position tracking (avoid full home-to-target traversal)

---

## 2.9.3: JS Module — `src/ios.js`

Single file, ~200 lines. Exports `connect(opts)` → page object.

### `connect()` Signature

```js
import { connect } from 'baremobile/ios';

const page = await connect({
  rsdAddress: 'fd07::1 62584',     // optional — override RSD tunnel discovery
  bleScript: 'path/to/ble.py',    // optional — default: test/ios/ble-hid-poc.py
  blePython: 'python3',           // optional — python for BLE HID
  pmd3Python: 'python3.12',       // optional — python for pymobiledevice3
  screenSize: {width: 375, height: 812},  // optional — logical points
});
```

**Behavior:**
1. Resolve RSD args: env var `RSD_ADDRESS` → file `/tmp/ios-rsd-address` → `pmd3('remote', 'browse')`
2. Verify device reachable: `pmd3('usbmux', 'list')`
3. Store UDID as `page.serial`
4. Do NOT start BLE HID yet — lazy on first input call
5. Return page object

### Page Object API

```js
const page = {
  serial,              // device UDID
  platform: 'ios',     // distinguishes from Android

  // Screenshots (pymobiledevice3, no BLE needed)
  async screenshot(),              // → PNG Buffer

  // App lifecycle (pymobiledevice3, no BLE needed)
  async launch(bundleId),          // → pid
  async kill(pid),                 // → void

  // Input (BLE HID — lazy-started on first call)
  async tapXY(x, y),              // home cursor + move + click (logical points)
  async type(text),               // BLE keyboard — types to whatever is focused
  async press(key),               // single key: enter, tab, delete, escape, space
  async swipe(x1, y1, x2, y2, duration),  // drag gesture

  // Navigation helpers
  async back(),                    // swipe from left edge
  async home(),                    // swipe-up-from-bottom or HID consumer key
  async longPressXY(x, y, ms),    // home + move + long click

  // Cleanup
  async close(),                   // kills BLE HID subprocess if running
};
```

### Methods intentionally omitted

| Method | Why |
|--------|-----|
| `snapshot()` | No accessibility tree on iOS. Use `screenshot()` + vision. |
| `tap(ref)` | No ref map. Use `tapXY()`. |
| `type(ref, text)` | No ref. Caller taps first via `tapXY()`, then `type(text)`. |
| `scroll(ref, dir)` | Use `swipe()` directly. |
| `waitForText()` | No text extraction without accessibility tree. |

### Internal: BleHidDaemon class (not exported)

Extracted and cleaned up from `test/ios/integration.test.js`:

```js
class BleHidDaemon {
  #proc = null;
  #ready = false;

  async start()              // spawn process, wait for "Ready."
  async ensurePaired(timeout) // wait for "notifications ON" for KB + MOUSE
  send(command)              // write to stdin
  async sendAndWait(cmd, ms) // send + delay

  // High-level
  async homeCursor()         // move -3000 -3000, guaranteed overshoot
  async moveTo(x, y)        // relative move from origin
  async click()              // mouse click
  async tapXY(x, y)         // homeCursor + moveTo + click
  async type(text)           // send_string
  async pressKey(char)       // send_key
  async stop()               // quit + SIGTERM fallback
}
```

**Lifecycle:** Lazy singleton — `ensureBle()` called on first input method. If already running, returns immediately. `close()` calls `stop()`.

**Root/pkexec:** Check `process.getuid?.() === 0` — if not root, wrap with `pkexec` (interactive auth prompt). Same pattern as integration tests.

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Module location | Single `src/ios.js` | ~200 lines, not worth directory split |
| BLE HID start | Lazy on first input | Avoids pkexec when only screenshots needed |
| RSD resolution | 3-step cascade (env → file → browse) | Reuses proven test pattern |
| No `snapshot()` | Vision-based only | iOS has no accessibility tree |
| `type(text)` no ref | Caller focuses via tapXY first | iOS keyboard types to current focus |
| Cursor movement | Home then relative | BLE mouse is relative-only, overshoot guarantees corner |
| BLE script path | `test/ios/ble-hid-poc.py` default | POC stays in test dir, `opts.bleScript` can override |
| pymobiledevice3 calls | Short-lived (spawn per command) | No persistent Python process needed |
| BLE HID | Long-running daemon | Pairing takes 120s, must stay alive |

---

## Build Order

### Step 1: Unified setup script
- `scripts/ios-tunnel.sh` — prerequisite checks, start tunnel + BLE, PID management
- Verify: run it, check both processes alive, `/tmp/ios-rsd-address` written

### Step 2: Live speed test
- `scripts/ios-live-test.js` — measure screenshot, tap, type, full-loop latency
- Validate speed strategies (persistent connection, cursor tracking)
- Results inform module implementation (timeouts, wait calculations)

### Step 3: Core scaffold + screenshot (no BLE)
- Create `src/ios.js` with: `resolveRsd()`, `connect()`, page with `screenshot()`, `launch()`, `kill()`, `close()` no-op
- Unit tests (`test/unit/ios.test.js`): mock execFile, verify RSD cascade, method signatures
- Integration (`test/ios/ios-connect.test.js`): screenshot returns PNG, launch/kill works

### Step 4: BLE HID daemon wrapper
- Add `BleHidDaemon` class to `src/ios.js`
- Unit tests: mock spawn for lifecycle, verify `ensureBle()` lazy pattern, `stop()` cleanup

### Step 5: Input methods
- Add `tapXY`, `type`, `press`, `swipe`, `back`, `home`, `longPressXY`
- Unit tests: verify command sequences, wait calculations
- Integration: tapXY on Settings, type in search, full loop

### Step 6: Package.json export
- Add `"./ios": "./src/ios.js"` to package.json exports

---

## Verification

After each step:
1. Unit tests pass: `node --test test/unit/ios.test.js`
2. Existing tests unbroken: `node --test test/unit/*.test.js test/integration/*.test.js`
3. Integration (requires device): `node --test test/ios/ios-connect.test.js`

---

## Files Created/Modified

| File | Action |
|------|--------|
| `scripts/ios-tunnel.sh` | New — unified setup script |
| `scripts/ios-live-test.js` | New — live speed test |
| `src/ios.js` | New — iOS module (~200 lines) |
| `test/unit/ios.test.js` | New — unit tests (mocked) |
| `test/ios/ios-connect.test.js` | New — integration tests |
| `package.json` | Modified — add `"./ios"` export |
