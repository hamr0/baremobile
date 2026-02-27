# Testing Guide

> 136 unit + 26 integration tests, 9 test files, zero test dependencies.

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
          │ Integr. │  26 tests — real device, full pipeline
          │  (26)   │  connect (16) + CLI session (10)
          ├─────────┤
          │  Unit   │  136 tests — pure functions, no device needed
          │  (136)  │  xml, prune, aria, interact, termux, termux-api, mcp, ios, usbmux
          └─────────┘
```

**Unit tests** run everywhere (CI, no device). **Integration tests** need an emulator or device. **E2E flows** are manually verified and documented in the blueprint obstacle course — they test multi-step agent scenarios that are too slow/flaky for automated runs.

---

## Test suites by module

### Core ADB

Covers: XML parsing, tree pruning, YAML formatting, interaction primitives, screen control.

**Unit tests (46 Android tests, no device needed):**

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

**CLI session tests (10 tests, requires ADB device):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/integration/cli.test.js` | 10 | open (daemon start + session.json) (1), status (running session) (1), snapshot (.yml file) (1), launch + snapshot (Settings content) (1), tap (ref from snapshot) (1), back (1), screenshot (.png file) (1), logcat (.json file) (1), close (cleanup) (1), status after close (non-zero exit) (1) |

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

### iOS (WDA)

Covers: `src/ios.js` — WDA-based iPhone control via HTTP. Same page-object pattern as Android.

**Unit tests (24 tests, no device needed):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/ios.test.js` | 24 | Module exports (2), translateWda node shape — bounds, hierarchy, invisible leaf skip, invisible container passthrough, switch/checked, editable, scrollable, name→contentDesc, self-closing, entities, disabled (13), prune+formatTree pipeline — refs, YAML format, checked/disabled state (5), CLASS_MAP integration (2), coordinate calculation from bounds (2) |
| `test/unit/usbmux.test.js` | 4 | listDevices plist parsing (1), connectDevice binary packet construction (1), forward TCP server lifecycle (1), protocol header format (1) |

**Real-device tests (15 tests, requires iPhone + WDA running):**

| File | Tests | What it covers |
|------|-------|----------------|
| `ios/test-wda.js` | 15 | snapshot with refs (1), screenshot PNG (1), launch Settings (1), tap Cell element (1), back navigation (1), scroll (1), swipe (1), home (1), waitForText (1), type into field (1), longPress (1), tapXY coordinates (1), press home/volumeup/volumedown (3) |

Real-device tests require WDA running at `localhost:8100`. Start with `baremobile setup` (option 3).

```bash
# Setup (once per session)
baremobile setup             # option 3: Start iPhone WDA server

# Run real-device tests
node ios/test-wda.js         # 15 tests against real iPhone

# Run unit tests (no device needed)
node --test test/unit/ios.test.js

# Teardown
baremobile ios teardown
```

**Manually verified E2E flows (iOS):**

| Flow | Steps |
|------|-------|
| Launch Settings + read screen | launch → snapshot → verify Wi-Fi/Bluetooth/General visible |
| Tap element by ref | snapshot → find Cell → tap(ref) → snapshot → verify navigation |
| Type in search field | find SearchField → type(ref, "wifi") → verify results |
| Back navigation | tap into sub-page → back() → verify return |
| Scroll long lists | Settings → scroll(ref, 'down') → verify new items |
| Screenshot capture | screenshot() → verify PNG magic bytes + reasonable size |
| Home button | home() → verify returns to launcher |
| Airplane Mode toggle | Settings → tap Airplane Mode switch → verify state change |

See [ios/SETUP.md](../../ios/SETUP.md) for first-time iOS setup and WDA installation.

**iOS MCP/CLI verification (manual, requires iPhone + WDA):**

| Step | Command | Expected |
|------|---------|----------|
| iOS session via CLI | `baremobile open --platform=ios` | Session started with platform ios |
| iOS snapshot | `baremobile snapshot` | YAML tree with iOS elements (Cell, NavBar) |
| iOS close | `baremobile close` | Session closed |
| MCP dual-platform | `snapshot({platform: 'ios'})` via MCP | iOS tree; `snapshot()` → Android tree |
| Cert warning | Delete `/tmp/baremobile-ios-signed`, call iOS MCP snapshot | Warning prepended |
| Setup wizard | `baremobile setup` → pick iOS | Guides through all steps |
| Resign | `baremobile ios resign` | Prompts for creds, signs, records timestamp |

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

### Cross-platform testing (Android + iOS)

Both platforms use the same page-object pattern: `connect()` → `snapshot()` → `tap(ref)`. Key differences for test authors:

| | Android | iOS |
|---|---|---|
| Transport | ADB (`child_process.execFile`) | WDA HTTP (`fetch()`) |
| Import | `import { connect } from 'baremobile'` | `import { connect } from 'baremobile/src/ios.js'` |
| App IDs | Package: `com.android.settings` | Bundle: `com.apple.Preferences` |
| Setup | `adb devices` | `baremobile setup` (option 3) |
| Unit tests | `node --test test/unit/*.test.js` | Same (includes `ios.test.js`) |
| Device tests | `node --test test/integration/*.test.js` | `node ios/test-wda.js` |
| Snapshot format | Hierarchical YAML tree | Hierarchical YAML tree (shared pipeline) |
| back() | ADB keypress | Find back button or swipe gesture |
