# Changelog

## 0.5.0

MCP server — 10 screen-control tools over JSON-RPC 2.0 stdio.

### New modules
- `mcp-server.js` — MCP server for Claude Code and other MCP clients
  - Raw JSON-RPC 2.0 over stdio, no SDK dependency
  - 10 tools: snapshot, tap, type, press, scroll, swipe, long_press, launch, screenshot, back
  - Singleton lazy session — `connect()` on first tool call, auto-detect ADB device
  - Action tools return `'ok'`, agent calls snapshot to observe
  - Screenshot returns MCP `image` content type (base64 PNG)
  - Large snapshots (>30K chars) saved to `.baremobile/screen-{timestamp}.yml`
- `.mcp.json` — MCP config file for auto-detection

### Tests
- 109 tests (93 unit + 16 integration), up from 94
- New: `test/unit/mcp.test.js` (15) — tool definitions, JSON-RPC dispatch, saveSnapshot logic

### Docs
- system-state.md: Phase 3 MCP → DONE, updated module count (9) and test count (109)
- prd.md: expanded Phase 3 roadmap with full tool list, session model, config
- baremobile.context.md: added MCP Server Integration section
- testing.md: added MCP test suite section, updated test pyramid counts

## 0.4.0

Termux support — on-device control via localhost ADB + direct Android API access via Termux:API.

### New modules
- `src/termux.js` — Termux environment detection + localhost ADB setup helpers
  - `isTermux()` — detect Termux via `TERMUX_VERSION` env or `/data/data/com.termux`
  - `findLocalDevices()` — scan `adb devices` for `localhost:*` entries
  - `adbPair(port, code)` / `adbConnect(port)` — wireless debugging setup
  - `resolveTermuxDevice()` — find localhost device or throw with setup instructions
- `src/termux-api.js` — 16 Termux:API wrappers (no ADB required)
  - SMS: `smsSend(number, text)`, `smsList(opts)`
  - Telephony: `call(number)`
  - Location: `location(opts)` (GPS/network/passive)
  - Camera: `cameraPhoto(file, opts)`
  - Clipboard: `clipboardGet()`, `clipboardSet(text)`
  - Contacts: `contactList()`
  - Notifications: `notify(title, content, opts)`
  - System: `batteryStatus()`, `volumeGet()`, `volumeSet(stream, value)`, `wifiInfo()`, `torch(on)`, `vibrate(opts)`
  - Detection: `isAvailable()`

### Changed
- `connect()` accepts `{termux: true}` option — resolves localhost ADB device
- `connect()` auto-detects Termux environment when no device specified

### Tests
- 83 tests (71 unit + 12 integration), up from 51
- New: `test/unit/termux.test.js` (14) — detection, parsing, commands, error messages
- New: `test/unit/termux-api.test.js` (18) — exports validation, availability detection, ENOENT errors

### Verified
- Termux ADB POC on emulator: `adb tcpip` → `adb forward` → `adb connect localhost:PORT` → full snapshot + tap + launch through localhost ADB
- Termux:API POC on emulator: sideloaded Termux + Termux:API from F-Droid, validated batteryStatus (JSON), clipboardGet/Set, volume (6 streams), wifiInfo (JSON), vibrate
- SMS/call/location/camera not tested on emulator (no SIM, no GPS hardware) — needs real device

### Docs
- Blueprint: restructured roadmap (dev order: core → termux → termux adb → MCP → CLI → bareagent → multis)
- Blueprint: three levels of phone control (Termux:API / ADB from host / ADB from Termux)
- Context.md: Termux setup, Termux:API usage patterns
- Testing guide: updated counts, new test file descriptions

## 0.3.0

Waiting, intents, platform docs, multis integration path.

### New features
- `page.waitForText(text, timeout)` — poll snapshot until text appears or timeout
- `page.waitForState(ref, state, timeout)` — poll for element state (enabled/disabled/checked/unchecked/focused/selected)
- `page.intent(action, extras?)` — deep navigation via Android intents (`am start -a`), supports string/int/boolean extras

### Docs
- Blueprint: connectivity modes (USB, WiFi, Tailscale), multis integration path, iOS WDA accessibility chain analysis
- context.md: waiting patterns, common intents, vision fallback, switch/toggle quirks, transitional states

### Tests
- 51 tests (39 unit + 12 integration), up from 48
- New: intent deep navigation, waitForText resolve + timeout

## 0.2.0

Screenshot-based vision fallback, coordinate tapping, grid system, entity decoding fix.

### New features
- `page.tapXY(x, y)` — tap by raw pixel coordinates, no ref needed
- `page.tapGrid(cell)` — tap by grid cell label (e.g. `"C5"`)
- `page.grid()` — get labeled grid: 10 cols (A-J), auto-sized rows, with `resolve(cell)` and `text` summary
- `screenSize()` in adb.js — get device screen dimensions via `wm size`

### Bug fixes
- XML entity decoding: `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` now decoded at parse time. Snapshots show `Network & internet` instead of `Network &amp; internet`.

### Tests
- 48 tests (39 unit + 9 integration), up from 36
- New: `test/unit/interact.test.js` (7) — buildGrid cell resolution, bounds, errors
- New: xml entity decoding tests (2)
- New: integration tests for grid, tapXY, tapGrid (3)

### Docs
- README: added device setup guide (USB debugging, WiFi, emulator)
- Blueprint: added future features (waitForText, intent shortcuts, vision fallback)
- Blueprint: added "Why not iPhone" section — WDA friction analysis, Android-only decision
- Blueprint: added Android device setup prerequisites

### Verified flows
- Bluetooth toggle: Settings → Connected devices → Connection preferences → Bluetooth → toggle off → toggle on (transitional `[disabled]` state observed and documented)
- Coordinate tap: `tapXY(540, 1200)` lands correctly on home screen
- Grid tap: `tapGrid('E10')` resolves and lands correctly

## 0.1.0

Core library — 6 modules, ~500 lines, zero dependencies, 36 tests.

### Modules
- `src/adb.js` — ADB transport: exec, shell, listDevices, dumpXml
- `src/xml.js` — Zero-dep regex XML parser for uiautomator output
- `src/prune.js` — 4-step pruning pipeline (assign refs, collapse wrappers, drop empties, dedup)
- `src/aria.js` — YAML formatter with 27 Android class-to-role mappings
- `src/interact.js` — tap, type, press, swipe, scroll, long-press via ADB input
- `src/index.js` — `connect(opts) → page` and `snapshot(opts)` public API

### API
- `connect({device})` — auto-detect or specify device serial
- `page.snapshot()` — uiautomator dump → parse → prune → YAML with `[ref=N]` markers
- `page.tap(ref)`, `page.type(ref, text)`, `page.press(key)`
- `page.swipe()`, `page.scroll(ref, direction)`, `page.longPress(ref)`
- `page.back()`, `page.home()`, `page.launch(pkg)`, `page.screenshot()`

### Tests
- 30 unit tests (xml, prune, aria)
- 6 integration tests (connect, snapshot, launch, back, screenshot, home)
- Integration tests auto-skip when no ADB device available

### Docs
- `docs/blueprint.md` — full architecture, module details, roadmap
- `docs/research.md` — platform feasibility research
- `docs/poc-plan.md` — POC validation criteria (completed, POC deleted)
