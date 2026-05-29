# System State

> Current as of v0.9.0 (May 2026) — types-compliance toolchain (JSDoc → `.d.ts`) + follow-up security hardening, on top of the v0.8.0 code-review fix plan.

## Architecture

```
src/
├── adb.js          — ADB transport: exec, device discovery, XML dump, shellQuote + validators
├── apps.js         — Android app helpers: grantPermission, revokePermission, clearAppData, listPermissions
├── aria.js         — Format tree as YAML with [ref=N] markers
├── daemon.js       — Background HTTP daemon: bounded logcat, parseTimeout, atomicWriteFileSync, pushBounded
├── debug.js        — DEBUG_BAREMOBILE traceCall observability gate
├── errors.js       — Typed error hierarchy: ElementNotFound, SelectorNotFound, WdaTimeout, WdaUnavailable, WaitTimeout, InvalidArgument, DeviceError + isConnectionError
├── index.js        — Public API: connect(opts) → page object (Android). Selector-based actions, waitForStable, bounded snapshot
├── interact.js     — tap, type, press, swipe, scroll, long-press
├── ios.js          — iOS API: connect(opts) → page object (WDA over HTTP). WDA fetch timeout, selector-based actions, waitForStable
├── ios-cert.js     — WDA cert expiry tracking (7-day free Apple ID certs)
├── prune.js        — Pruning pipeline + ref assignment + maxDepth/maxNodes
├── session-client.js — HTTP client to a daemon
├── setup.js        — Unified setup wizard
├── termux.js       — Termux detection + localhost ADB setup helpers
├── termux-api.js   — Termux:API: SMS, calls, location, camera, clipboard (no ADB)
├── usbmux.js       — Node.js usbmuxd client for iOS USB connection
├── wifi-persist.js — Saved WiFi device load/save with IPv4 validation + corrupt-record cleanup
└── xml.js          — Zero-dep XML parser (pure, no I/O)

cli.js              — CLI entry point
mcp-server.js       — MCP server: JSON-RPC 2.0 over stdio, 17 tools, dual-platform, platform:'auto' + multi-device serial
```

18 src modules + 2 entry points, zero runtime dependencies.

## v0.8.0 deltas (code-review fix plan)

- **Security**: `shellQuote`, `validatePackage`, `validateIntentAction`, `validateExtraKey` close shell-injection vectors in `launch()`/`intent()` and downstream Android app helpers.
- **Robustness**: WDA fetches carry `AbortSignal.timeout`; daemon `close` flushes body before exit; iOS `connect()` cleans up usbmuxd on bring-up failure; logcat capped at 50k lines via `pushBounded`; `wifi-persist` rejects malformed IPs; `parseTimeout` rejects malformed strings; `atomicWriteFileSync` for session.json.
- **Typed errors**: all hot-path `throw new Error` migrated to typed classes; MCP retry tiers gate via `isConnectionError(err)` instead of substring matching.
- **Agent ergonomics**: `tap`/`type`/`scroll`/`longPress` accept selectors `{text|contentDesc}`; `waitForStable({pollMs, stableMs, timeout})`; `snapshot({maxDepth, maxNodes})`; MCP `wait_stable` tool.
- **MCP**: `platform: 'auto'` probe+cache; `serial` arg on every tool; `_pages` keyed by `{platform, serial}`; tool descriptions lead with `[android|ios]` / `[ios-only]` etc.; 17 tools total (added `activate`, `wait_stable`, `grant_permission`, `revoke_permission`, `clear_app_data`, `list_permissions`).
- **Observability**: `DEBUG_BAREMOBILE=1` mirrors every adb/wda call to stderr with channel, label, outcome, latency.

## Security hardening (v0.9.0 — follow-up audit)

Second-pass audit after the types-compliance work. Scope was the local control surface (no server/DB/web). Command-injection sinks re-confirmed clean (array-arg `execFile` everywhere; `interact.js` coerces coords + double-escapes `type()` text). Findings fixed:

- **Daemon auth (Medium)**: `/command` now requires a per-session `randomBytes(32)` token (constant-time compare) carried in the `0600` `session.json`; client sends it transparently. Closes cross-uid device control — loopback is reachable by any local uid, so the prior `0600`-only gate (v0.8.1) protected port *discovery* but not the port itself. `/command` also caps the request body at 1 MiB (`413`).
- **Predictable `/tmp` (Low)**: `ios-cert.js` (`ios-signed`) and `setup.js` (`ios-pids`, fed to `process.kill`) moved to `~/.config/baremobile/`; Android cmdline-tools download/extract now uses an owner-only `mkdtemp` dir (was fixed `/tmp`, then executed → TOCTOU). Brings the last stragglers in line with the `ios.js`/`wifi-persist.js` per-user decision.
- **Hygiene (Low)**: two real device UDIDs redacted from `ios/aria-kba-old/wda-ios-automation-poc.md` (still in history — identifiers, not secrets).

Regression tests: `test/unit/security-validation.test.js` (16) + updated `loadPids` tests. Suite 301 → 317, all green; `tsc --noEmit` clean.

## What's built

| Phase | Status | What |
|-------|--------|------|
| 1.0 Core library | DONE | connect, snapshot, tap/type/press/swipe/scroll/longPress/launch/screenshot |
| 1.5 Vision fallback | DONE | tapXY, tapGrid, buildGrid, screenSize, XML entity decoding |
| 1.6 Waiting + intents | DONE | waitForText, waitForState, intent() |
| 2.0 Termux ADB | DONE | isTermux, findLocalDevices, adbPair/Connect, connect({termux: true}) |
| 2.5 Termux:API | DONE | 16 wrappers: SMS, calls, location, camera, clipboard, battery, volume, etc. |
| 2.9–2.95 iOS BLE HID | DONE (superseded) | pymobiledevice3 + BLE HID approach. Replaced by WDA in Phase 3.0. |
| 3.0 iOS WDA rewrite | DONE | `src/ios.js` rewritten — WDA over HTTP. Real element tree, native click, zero Python at runtime. Same `snapshot()` → `tap(ref)` pattern as Android. |
| 3.1 iOS translation layer | DONE | `translateWda()` converts WDA XML → Android node shape → shared `prune()` + `formatTree()` pipeline. Coordinate-based tap/scroll/longPress. Hierarchical YAML output identical to Android. |
| 3.2 iOS usbmux + auto-connect | DONE | Node.js usbmuxd client replaces pymobiledevice3 port forwarder. Auto-discovery: WiFi (cached) > USB > localhost. unlock() error handling. iOS = QA only (USB required). |
| 3.3 iOS CLI + MCP integration | DONE | Dual-platform MCP (platform param on all tools), CLI --platform flag, setup wizard, ios resign/teardown commands, cert expiry tracking (ios-cert.js). |
| 3.4 iOS navigation fixes | DONE | W3C Actions tap (replaces silent /wda/tap), screen-size-aware back() fallback, launch/activate error checking, MCP WDA auto-reconnect. |
| 3.5 iOS snapshot cleanup + auto-restart | DONE | Keyboard/Unicode/file-path stripping, internal name filter, findByText helper, WDA tunnel auto-restart via restartWda(). restartWda() tier-1: stored RSD in PID file enables WDA-only restart (~3s) without pkexec. |
| 3.6 iOS custom-UI refs + scale factor | DONE | `accessible` attr parsing for custom-UI elements (Telegram chat rows), Retina scale factor API (`scaleFactor`, `screenshotToPoint`). |
| 4.0 Code-review fix plan — Phase 1 (Critical) | DONE | Shell-injection blockers in `launch`/`intent`; iOS `connect()` cleanup-on-failure; daemon close-response flush; WDA fetch timeout. |
| 4.1 Code-review fix plan — Phase 2 (Important) | DONE | `parseTimeout` validation; iOS `back()` rotation-aware fallback; bounded logcat ring buffer; wifi-persist IP validation; structured `find_by_text` return; `resolvePlatform` helper; per-tool `_platforms` gate. |
| 4.2 Code-review fix plan — Phase 3 (Cleanup) | DONE | iOS `activate` exposed in CLI/daemon/MCP; dead col-bounds check removed; stale comments cleaned; atomic `session.json` write. |
| 4.3 Code-review fix plan — Phase 4a (Foundations) | DONE | Typed error hierarchy (8 classes + `isConnectionError`); `platform:'auto'` probe+cache; `DEBUG_BAREMOBILE` observability. |
| 4.4 Code-review fix plan — Phase 4b (Agent QoL) | DONE | Selector-based actions (`{text\|contentDesc}`); `waitForStable`; bounded snapshot (`maxDepth`, `maxNodes`). |
| 4.5 Code-review fix plan — Phase 4c (Multi-target) | DONE | Android app helpers (grant/revoke/clear/list permissions); `_pages` keyed by `{platform, serial}`; serial threaded through MCP. |

## What's next

| Phase | Status | What |
|-------|--------|------|
| 2.7 iOS pymobiledevice3 spike | DONE | Screenshots, app launch/kill, device info from Linux over USB. Historical. |
| 2.8 iOS BLE HID input spike | DONE | BLE keyboard + mouse + combo proven. Superseded by WDA. |
| 3 MCP server | DONE | JSON-RPC 2.0 over stdio, 10 tools (same pattern as barebrowse) |
| 4 CLI session mode | DONE | cli.js + daemon.js + session-client.js |
| 5 bareagent adapter | TODO | createMobileTools() → {tools, close} for bareagent Loop |
| 6 WebView CDP bridge | TODO | Attach CDP to debug-enabled WebViews |
| 7 Advanced interactions | TODO | pinch, drag, clipboard, notification shade |

## Tests

301 unit tests + integration tests (skip cleanly when no device attached). All passing.

Run: `node --test test/unit/*.test.js test/integration/*.test.js`

New test files added in v0.8.0:
- `test/unit/adb.test.js` — shellQuote roundtrip + validator fuzz
- `test/unit/daemon.test.js` — parseTimeout, pushBounded, atomicWriteFileSync (via phase3), close-response flush contract
- `test/unit/wifi-persist.test.js` — IPv4 boundary + corrupt-record cleanup
- `test/unit/phase-stress.test.js` — 21 stress tests across all Phase 1+2 fixes (POSIX shell roundtrip on 500 random strings, concurrent hung-WDA, etc.)
- `test/unit/phase-necessity.test.js` — pre-fix-pattern reproductions proving each Phase 1+2 fix is necessary
- `test/unit/phase3-validation.test.js` — Phase 3 regression + necessity (atomicWriteFileSync inode contract, 200-rev rapid-write loop)
- `test/unit/phase4a-validation.test.js` — typed errors, platform-auto cache, DEBUG flag (child-process env roundtrip)
- `test/unit/phase4b-validation.test.js` — selector wiring, waitForStable algorithm, 50-trial randomised prune-bounds stress
- `test/unit/phase4c-validation.test.js` — app helper validators, pageKey contract

### iOS test plans

Template at `test/ios-test-plan.template.md` — copy per app to `test/plans/[app-name].md`. Includes navigation map (app structure captured upfront), scenarios with verify assertions, edge case handling. Feed to MCP client for agent-driven testing.

iOS tests from Phase 2.7–2.95 (BLE HID era) have been removed. iOS validation is now done via unit tests (`ios.test.js` + `usbmux.test.js`) and manual testing against WDA. Note: iOS is QA-only — WiFi tunnel requires Xcode/Mac for WiFi pairing, USB cable is required on Linux.

## Validation

- Core ADB: 13 E2E flows verified on API 35 emulator
- Termux ADB: POC validated (snapshot + tap + launch via localhost)
- Termux:API: POC validated with Node.js inside Termux (battery, clipboard, volume, wifi, vibrate)
- Termux:API (not yet validated): SMS, calls, location, camera (needs real device)
- iOS WDA: `src/ios.js` — connect, snapshot, tap(ref), type, scroll, swipe, longPress, launch, back, home, screenshot, waitForText, tapXY, findByText, scaleFactor, screenshotToPoint. Translation layer (`translateWda()`) converts WDA XML → Android node shape → shared prune pipeline. Reads `accessible` attr for custom-UI ref assignment (Telegram-style apps). Coordinate-based tap/scroll/longPress from bounds. Hierarchical YAML output identical to Android. Taps use W3C Actions API (not /wda/tap). launch/activate check error responses. MCP server auto-reconnects on WDA death, auto-restarts WDA on second failure (tier-1: WDA-only restart in ~3s using stored RSD, no pkexec; tier-2: full tunnel restart if RSD missing or tunnel dead). Snapshot cleanup: keyboard subtree stripped, Unicode noise removed, iOS file paths stripped, internal class names filtered. Retina scale factor computed at connect time for screenshot-to-point coordinate conversion.
