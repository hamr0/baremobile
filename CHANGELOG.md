# Changelog

## 0.7.3

Setup wizard hardening — graceful error handling, AltServer anisette fallback, output filtering.

### Fixed
- **pkexec cancel**: `waitForOutput()` now listens for process `close` event. Cancelled pkexec rejects instantly instead of waiting 20s timeout. Shows "authentication was cancelled" instead of raw error dump.
- **AltServer 502**: Anisette server `armconverter.com` returns 502 intermittently. Setup now auto-retries with `ani.sidestore.io` fallback. Configurable via `ALTSERVER_ANISETTE_SERVER` env var.
- **AltServer cached 2FA**: When Apple session is cached (no 2FA needed), AltServer installs directly. Setup now detects "successfully installed" as success, skips 2FA prompt.
- **AltServer wrong password**: Shows "Double-check your Apple ID email and password" instead of generic server error.
- **AltServer noise**: Filters debug output (signing progress floats, byte dumps, anisette headers, file writes). Only shows: Installing, 2FA prompt, Finished, errors.
- **AltServer stale processes**: Kills leftover AltServer processes before each signing attempt.
- **WDA untrusted profile**: Detects "not been explicitly trusted" error, prompts user to trust cert, retries WDA launch without redoing tunnel/DDI/forward.
- **Setup hangs on exit**: `unref()` WDA/tunnel child stdio pipes and usbmux forward server so Node exits cleanly.
- **Integration tests fail without device**: `cli.test.js` now skips with "No ADB device available" (same as `connect.test.js`).

### Changed
- **Setup step reorder**: WDA install (step 6) now happens before device settings (step 7). Developer Mode toggle only appears after a dev app is installed, so checking it first was wrong.
- **Device settings consolidated**: Developer Mode + VPN trust + UI Automation shown as numbered checklist in one step with clear paths to each setting.
- **Step count**: iOS setup reduced from 10 to 9 steps.

## 0.7.2

- **fix**: `findWdaBundle()` ENOBUFS — `pymobiledevice3 apps list` returns ~3.5MB JSON, exceeded default 1MB `maxBuffer`. Increased to 10MB.

## 0.7.1

Unified `baremobile setup` wizard — one command for Android and iOS setup on Linux, macOS, and WSL.

### New modules
- `src/setup.js` — All setup logic (~400 lines). 4-option menu: Android setup, iOS from scratch (10 steps), start WDA server (5 steps), renew cert (4 steps), teardown. Cross-platform: detects OS + package manager, platform-specific install instructions.

### New features
- **Setup wizard overhaul**: `baremobile setup` now handles everything — tunnel, DDI mount, WDA launch, port forward, AltServer signing — no shell scripts needed.
- **Cross-platform**: Supports Linux (pkexec, dnf/apt), macOS (sudo/xcrun, brew), WSL (sudo, apt). Auto-detects `findPython()` instead of hardcoding `python3.12`.
- **WDA health check**: `src/ios.js` `connect()` calls `wdaReady()` before session creation — fails fast with actionable error message.
- **isMain guard fix**: `mcp-server.js` guards against undefined `process.argv[1]`.

### Changed
- `cli.js` — Thin routing only. Setup/resign/teardown delegate to `src/setup.js`. Added `createUi()` for colored terminal output. Removed ~200 lines.
- Device field names fixed: uses `deviceId`/`serial` (actual usbmux fields) instead of `connectionType`/`serialNumber`.

### Removed
- `ios/setup.sh` — Replaced by `startWda()` in `src/setup.js`
- `ios/teardown.sh` — Replaced by `teardown()` in `src/setup.js`

### Tests
- `test/unit/setup.test.js` — 12 tests: `detectHost`, `which`, `parseTunnelOutput`, `parseWdaBundleFromJson`
- Total: 148 unit tests passing

---

## 0.7.0

iOS full integration — dual-platform MCP, CLI `--platform` flag, setup wizard, cert tracking.

### New modules
- `src/ios.js` — Rewritten WDA-based iOS control. Translation layer (`translateWda()`) converts WDA XML → Android node shape → shared `prune()` + `formatTree()` pipeline. Auto-discovery: cached WiFi > USB (usbmux) > localhost. Coordinate-based tap/scroll/longPress from bounds.
- `src/usbmux.js` — Node.js usbmuxd client (~130 lines, zero deps). Binary protocol to `/var/run/usbmuxd`. Replaces pymobiledevice3 port forwarder (was crashing with socket cleanup race).
- `src/ios-cert.js` — WDA cert expiry tracking. `checkIosCert()` warns when 7-day free Apple ID cert is stale. `recordIosSigning()` records timestamp.
- `ios/setup.sh` — Start iOS bridge: tunnel + DDI mount + WDA launch
- `ios/teardown.sh` — Stop all iOS bridge processes

### New features
- **Dual-platform MCP**: `mcp-server.js` holds per-platform page slots, lazy-created. Every tool accepts `platform: "ios"` (default: android). Both platforms in same session.
- **CLI `--platform=ios`**: `baremobile open --platform=ios` starts iOS daemon. Platform stored in session.json. Android-only commands (`logcat`, `intent`, `tap-grid`, `grid`) return error on iOS.
- **Setup wizard**: `baremobile setup` — interactive, auto-detects what's done, guides through remaining steps for Android or iOS.
- **Cert resign**: `baremobile ios resign` — interactive AltServer signing with Apple ID + password + 2FA prompts. Records timestamp for expiry tracking.
- **iOS teardown**: `baremobile ios teardown` — kills tunnel/WDA processes.
- **Cert warning**: MCP prepends warning to first iOS snapshot if cert is >6 days old or missing.

### Changed
- `src/daemon.js` — Dynamic import based on platform, logcat skipped for iOS, Android-only handler guards, platform in session.json
- `cli.js` — `--platform` flag, setup/resign/teardown commands, updated usage text
- `mcp-server.js` — Removed static import, per-platform page cache, platform param on all tools, neutralized descriptions
- `src/aria.js` — 29 iOS CLASS_MAP entries (Button, Text, Cell, Switch, Key, Icon, etc.)
- `src/prune.js` — iOS-compatible pruning (editable detection, bounds handling)

### Removed
- BLE HID era scripts and tests (moved to `ios/aria-kba-old/` for reference)
- `scripts/ios-ax.py`, `scripts/ios-live-test.js`, `scripts/ios-tunnel.sh`
- `test/ios/` — replaced by `test/unit/ios.test.js` + `ios/test-wda.js`

### Tests
- 136 unit tests (up from 129), 26 integration tests, 9 test files
- New: `test/unit/ios.test.js` — 24 tests (translateWda shape, pipeline integration, CLASS_MAP, coordinates)
- New: `test/unit/usbmux.test.js` — 4 tests (plist parsing, packet construction, forward lifecycle, header format)

### Docs
- All 7 doc files updated for Phase 3.3
- `baremobile.context.md`: MCP tools table with `platform?`, setup/resign commands
- `docs/customer-guide.md`: iOS prerequisites, resign flow, CLI/MCP iOS usage
- `docs/01-product/prd.md`: Phase 3.3 added, MCP section updated for dual-platform
- `docs/04-process/testing.md`: iOS MCP verification steps
- iOS = QA only stated clearly everywhere (USB required on Linux)

## 0.6.0

CLI session mode — 22 commands, logcat capture, `--json` flag for agent consumption.

### New modules
- `src/daemon.js` — Background HTTP server holding a `connect()` session, logcat capture via `adb logcat` child process
- `src/session-client.js` — HTTP client to daemon (sendCommand, readSession, isAlive)

### New features
- `cli.js` — Full CLI with 22 commands: `open`, `close`, `status`, `snapshot`, `screenshot`, `grid`, `tap`, `tap-xy`, `tap-grid`, `type`, `press`, `scroll`, `swipe`, `long-press`, `launch`, `intent`, `back`, `home`, `wait-text`, `wait-state`, `logcat`, `mcp`
- Logcat capture: daemon spawns `adb logcat` in background, buffers entries, flushes to `.baremobile/logcat-*.json` on demand. Supports `--filter=TAG` and `--clear`.
- `--json` flag: any command outputs a single JSON line (`{"ok":true,...}` or `{"ok":false,"error":"..."}`). Agents parse one line per invocation — no text formatting to strip.
- `"bin": {"baremobile": "cli.js"}` in package.json — `npx baremobile` works

### Tests
- 129 tests (103 unit + 26 integration), up from 109
- New: `test/integration/cli.test.js` (10) — open, status, snapshot, launch+snapshot, tap, back, screenshot, logcat, close, status-after-close

### Docs
- prd.md: Phase 4 marked DONE with command reference and `--json` flag
- baremobile.context.md: CLI Session Mode section with commands, output conventions, JSON mode, agent usage
- customer-guide.md: CLI session guide with full command reference table, JSON mode for agents
- testing.md: updated counts (119→129), added CLI test suite section
- README.md: CLI added as first usage option ("Four ways to use it")

## 0.5.1

### Bug fixes
- `interact.js`: fixed ref type coercion in `resolveRef()` — MCP passes refs as strings but refMap keys are integers. Added `Number()` coercion.

### Validation
- Tested all 10 MCP tools end-to-end on real emulator (API 35)
- Full workflow verified: launch Settings, tap, type search, scroll, back, screenshot
- Drove Messages app: compose → type number → type message → send

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
