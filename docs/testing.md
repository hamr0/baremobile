# Testing Guide

> 83 tests, 6 test files, zero test dependencies.

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
          │ Integr. │  12 tests — real device, full pipeline
          │  (12)   │  connect → snapshot → tap → screenshot
          ├─────────┤
          │  Unit   │  71 tests — pure functions, no device needed
          │  (71)   │  xml, prune, aria, interact, termux, termux-api
          └─────────┘
```

**Unit tests** run everywhere (CI, no device). **Integration tests** need an emulator or device. **E2E flows** are manually verified and documented in the blueprint obstacle course — they test multi-step agent scenarios that are too slow/flaky for automated runs.

## Test files

### Unit tests (71 tests, no device needed)

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/xml.test.js` | 12 | `parseBounds` (3): standard, empty, malformed. `parseXml` (9): single node, nested tree, self-closing, editable detection, empty/error input, all 12 attributes, XML entity decoding (`&amp;` → `&`), all 5 entity types |
| `test/unit/prune.test.js` | 10 | Collapse single-child wrappers, keep ref nodes, drop empty leaves, ref assignment on interactive nodes, dedup same-text siblings, skip dedup on ref nodes, refMap returned, null root, contentDesc kept, state-bearing nodes kept |
| `test/unit/aria.test.js` | 10 | `shortClass` (5): core widgets, layouts→Group, AppCompat/Material, unknown→last segment, empty→View. `formatTree` (5): all fields + ref + states, nesting/indentation, disabled, multiple states, empty node |
| `test/unit/interact.test.js` | 7 | `buildGrid`: column/row auto-sizing, A1→top-left center, J-max→bottom-right, case-insensitive resolve, invalid cell format error, out-of-range row error, text includes dimensions |
| `test/unit/termux.test.js` | 14 | `isTermux` (2): env var detection, path fallback. `findLocalDevices` (2): live adb + empty array. `adbPair`/`adbConnect` (2): command construction (no usage errors). `resolveTermuxDevice` (1): error message content. Parsing logic (7): typical output, non-localhost, offline, multiple devices, empty, mixed types, extra whitespace |
| `test/unit/termux-api.test.js` | 18 | Module exports (2): all 16 functions present, count exact. `isAvailable` (1): returns false on non-Termux. ENOENT errors (15): all API functions throw correctly when commands not found |

### Integration tests (12 tests, requires ADB device)

| File | Tests | What it covers |
|------|-------|----------------|
| `test/integration/connect.test.js` | 12 | Page object has all methods, `snapshot()` returns YAML with refs, `launch()` opens Settings, `press('back')` navigates, `screenshot()` returns valid PNG, `grid()` returns resolve function, `tapXY()` taps coordinates, `tapGrid()` taps by cell, `intent()` deep navigation, `waitForText()` resolves + timeout, `home()` returns to launcher |

### Termux validation status

| Layer | Tested | How | Result |
|-------|--------|-----|--------|
| **Termux ADB** (`termux.js`) | Yes (emulator) | POC: `adb tcpip` → `adb forward` → `adb connect localhost:PORT` → `connect({termux: true})` → snapshot + tap + launch | All work through localhost ADB |
| **Termux:API** (`termux-api.js`) | No (unit only) | Requires physical device with Termux + Termux:API addon. Unit tests verify exports + ENOENT errors. | Awaiting real device validation |

**To validate Termux:API on a real device:**
1. Install Termux from F-Droid
2. Install Termux:API addon from F-Droid
3. `pkg install termux-api nodejs-lts`
4. Copy baremobile to device, run:
```js
import * as api from './src/termux-api.js';
console.log('available:', await api.isAvailable());
console.log('battery:', await api.batteryStatus());
console.log('clipboard:', await api.clipboardGet());
await api.clipboardSet('test'); console.log('set:', await api.clipboardGet());
console.log('contacts:', (await api.contactList()).length);
console.log('wifi:', await api.wifiInfo());
```

### Manually verified E2E flows (documented in blueprint)

These were tested end-to-end on API 35 emulator and are too stateful/slow for automated tests:

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
| Termux ADB (POC) | tcpip → forward → connect localhost → snapshot → launch Settings → tap → home |

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
