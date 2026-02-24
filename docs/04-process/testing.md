# Testing Guide

> 109 tests, 7 test files, zero test dependencies.

## Run all tests

```bash
node --test test/unit/*.test.js test/integration/*.test.js
```

Integration tests auto-skip when no ADB device is available.

## Test pyramid

```
          ┌─────────┐
          │  E2E    │  Manual verified flows (Bluetooth toggle,
          │  (0)    │  SMS send, emoji, file attach — see blueprint)
          ├─────────┤
          │ Integr. │  16 tests — real device, full pipeline
          │  (16)   │  connect → snapshot → tap → type → scroll → swipe
          ├─────────┤
          │  Unit   │  93 tests — pure functions, no device needed
          │  (93)   │  xml, prune, aria, interact, termux, termux-api, mcp
          └─────────┘
```

**Unit tests** run everywhere (CI, no device). **Integration tests** need an emulator or device. **E2E flows** are manually verified and documented in the blueprint obstacle course — they test multi-step agent scenarios that are too slow/flaky for automated runs.

---

## Test suites by module

### Core ADB

Covers: XML parsing, tree pruning, YAML formatting, interaction primitives, screen control.

**Unit tests (46 tests, no device needed):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/xml.test.js` | 12 | `parseBounds` (3): standard, empty, malformed. `parseXml` (9): single node, nested tree, self-closing, editable detection, empty/error input, all 12 attributes, XML entity decoding (`&amp;` → `&`), all 5 entity types |
| `test/unit/prune.test.js` | 10 | Collapse single-child wrappers, keep ref nodes, drop empty leaves, ref assignment on interactive nodes, dedup same-text siblings, skip dedup on ref nodes, refMap returned, null root, contentDesc kept, state-bearing nodes kept |
| `test/unit/aria.test.js` | 10 | `shortClass` (5): core widgets, layouts→Group, AppCompat/Material, unknown→last segment, empty→View. `formatTree` (5): all fields + ref + states, nesting/indentation, disabled, multiple states, empty node |
| `test/unit/interact.test.js` | 14 | `buildGrid` (7): column/row auto-sizing, A1→top-left center, J-max→bottom-right, case-insensitive, invalid cell, out-of-range, text. Error handling (7): press unknown key, tap missing ref, tap no bounds, scroll unknown direction, scroll missing ref, type missing ref, longPress missing ref |

**Integration tests (16 tests, requires ADB device):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/integration/connect.test.js` | 16 | Page object methods (1), snapshot YAML with refs (1), launch app (1), press back (1), screenshot PNG (1), grid resolve (1), tapXY (1), tapGrid (1), intent deep nav (1), waitForText resolve + timeout (2), tap by ref (1), type into search (1), scroll within element (1), raw swipe (1), home (1) |

**Manually verified E2E flows:**

| Flow | Steps |
|------|-------|
| Open app + read screen | launch Settings → snapshot → verify text |
| Search by typing | Settings → tap search → type "wifi" → verify results |
| Navigate back/home | press back, press home → verify screen change |
| Scroll long lists | Settings → scroll down → verify new items |
| Send SMS | Messages → new chat → recipient → compose → send |
| Insert emoji | Compose → emoji panel → tap emoji → verify in input |
| File attachment | Compose → + → Files → picker → select file |
| Dismiss dialogs | Dialog appears → read text → tap OK |
| Toggle Bluetooth | Settings → Connected devices → Connection preferences → Bluetooth → toggle off/on |
| Screenshot capture | screenshot() → verify PNG magic bytes |
| Tap by coordinates | tapXY(540, 1200) on home screen |
| Tap by grid cell | tapGrid('E10') → resolves + taps correctly |

---

### Termux ADB

Covers: Termux environment detection, localhost ADB device discovery, pairing/connect helpers.

**Unit tests (14 tests, no device needed):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/termux.test.js` | 14 | `isTermux` (2): env var detection, path fallback. `findLocalDevices` (2): live adb + empty array. `adbPair`/`adbConnect` (2): command construction (no usage errors). `resolveTermuxDevice` (1): error message content. Parsing logic (7): typical output, non-localhost, offline, multiple devices, empty, mixed types, extra whitespace |

**POC validation (emulator):**

| Flow | Steps | Result |
|------|-------|--------|
| Localhost ADB connection | `adb tcpip` → `adb forward` → `adb connect localhost:PORT` | Device detected |
| Snapshot via localhost | `snapshot()` through localhost ADB | Same YAML as USB ADB |
| Launch + tap + home | `launch(settings)` → `tap(ref)` → `home()` | All work through localhost |

All Core ADB integration tests apply identically (same `adb.js`, different serial).

---

### Termux:API

Covers: 16 Termux:API command wrappers, availability detection.

**Unit tests (18 tests, no device needed):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/termux-api.test.js` | 18 | Module exports (2): all 16 functions present, count exact. `isAvailable` (1): returns false on non-Termux. ENOENT errors (15): all API functions throw correctly when commands not found |

**POC validation (emulator with sideloaded Termux + Termux:API):**

Validated on API 35 emulator with:
- Sideloaded `com.termux_1022.apk` + `com.termux.api_1002.apk` from F-Droid
- `pkg install termux-api nodejs-lts` inside Termux (Node v24.13.0)

| Command | Bash POC | Node.js POC |
|---------|----------|-------------|
| batteryStatus | PASS — JSON | PASS — execFile + JSON.parse |
| clipboardGet/Set | PASS | PASS |
| volumeGet | PASS — 6 streams | PASS |
| wifiInfo | PASS — JSON | PASS |
| vibrate | PASS | PASS |

**Not yet validated (needs real device with SIM + GPS):**

| Command | Why |
|---------|-----|
| `smsSend` / `smsList` | Requires SIM card |
| `call` | Requires SIM card |
| `location` | Requires GPS hardware |
| `cameraPhoto` | Requires camera hardware |
| `contactList` | Requires contacts on device |

```bash
# To validate on a real device (inside Termux):
termux-sms-send -n 5551234 "test"
termux-sms-list -l 3
termux-telephony-call 5551234
termux-location -p network
termux-camera-photo /sdcard/test.jpg
termux-contact-list
```

---

### MCP Server

Covers: tool definitions, JSON-RPC dispatch, snapshot save logic.

**Unit tests (15 tests, no device needed):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/mcp.test.js` | 15 | Tool list (8): count, names, schemas, required params. JSON-RPC dispatch (5): initialize, notifications/initialized, tools/list, unknown method, unknown tool error. saveSnapshot (2): file write + maxChars threshold |

---

### iOS (pymobiledevice3 + BLE HID)

Covers: iPhone screenshot capture, app lifecycle, device info via pymobiledevice3; BLE HID keyboard/mouse input via BlueZ.

**Prerequisite checker pattern:** iOS tests require external tools (Python 3.12, pymobiledevice3, usbmuxd, iPhone connected). A standalone checker validates all prerequisites before tests run:

```bash
npm run ios:check    # validate prerequisites + iPhone connection
```

The checker (`test/ios/check-prerequisites.js`) validates: Python 3.12 installed, pymobiledevice3 available, usbmuxd running, iPhone connected via USB, Developer Mode enabled, tunneld reachable. Each check has a fix hint on failure.

**Spike tests (8 tests, requires iPhone + USB):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/ios/screenshot.test.js` | 8 | Device detection via usbmux (1), lockdown info (1), developer mode status (1), developer image mount (1), screenshot capture + size validation (1), process list (1), app launch + kill (1), screenshot latency measurement (1) |

Tests call `python3.12 -m pymobiledevice3` via `child_process.execFile`. RSD tunnel address resolved from: env var `RSD_ADDRESS`, file `/tmp/ios-rsd-address` (written by `ios-tunnel.sh`), or `remote browse` auto-discovery.

Developer service tests (screenshot, processes, launch/kill, latency) gracefully skip when Developer Mode is not enabled or tunneld is not running — they log the skip reason instead of failing.

**BLE HID tests (planned — Phase 2.8 spike):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/ios/ble-hid.test.js` | TBD | BLE adapter detection, GATT server startup, keyboard input, mouse input, integration with screenshot |

BLE HID tests follow the same pattern: prerequisite check (BlueZ version, adapter capabilities, `dbus-python` installed), graceful skip when BLE hardware not available. Python BLE GATT server called via `child_process.execFile`.

```bash
npm run ios:check    # validate prerequisites + iPhone connection
npm run test:ios     # 8 pymobiledevice3 spike tests
```

```
test/ios/
  check-prerequisites.js   # validate python, pymobiledevice3, usbmuxd, device
  screenshot.test.js       # pymobiledevice3 spike: device, lockdown, screenshot, app lifecycle
  ble-hid-poc.py           # BLE HID GATT server (Python, BlueZ D-Bus)
  ble-hid.test.js          # BLE HID spike tests (Node.js wrapper)
```

See [dev-setup.md](dev-setup.md#ios-researchspike--not-yet-built) for iOS prerequisites and setup.

---

## Writing new tests

**Unit tests:** Pure function in, value out. No device, no I/O. Import from `src/`, assert results.

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid } from '../../src/interact.js';

describe('buildGrid', () => {
  it('creates 10 columns', () => {
    const g = buildGrid(1080, 2400);
    assert.strictEqual(g.cols, 10);
  });
});
```

**Integration tests:** Need `connect()` → page object. Use the skip pattern for CI:

```js
import { listDevices } from '../../src/adb.js';

let hasDevice = false;
try {
  const devices = await listDevices();
  hasDevice = devices.length > 0;
} catch { hasDevice = false; }

describe('my test', { skip: !hasDevice && 'No ADB device' }, () => {
  // tests here
});
```

**Key rules:**
- Use `node:test` and `node:assert/strict` only — no test frameworks
- Integration tests must auto-skip without a device (top-level await for detection)
- Don't cache refs across snapshots — they reset every call
- Add settle delays after actions (`await new Promise(r => setTimeout(r, 500))`) before snapshotting
