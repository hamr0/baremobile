# System State

> Current as of February 2026.

## Architecture

```
src/
├── adb.js        — ADB transport: exec, device discovery, XML dump
├── termux.js     — Termux detection + localhost ADB setup helpers
├── termux-api.js — Termux:API: SMS, calls, location, camera, clipboard (no ADB)
├── xml.js        — Zero-dep XML parser (pure, no I/O)
├── prune.js      — Pruning pipeline + ref assignment
├── aria.js       — Format tree as YAML with [ref=N] markers
├── interact.js   — tap, type, press, swipe, scroll, long-press
├── index.js      — Public API: connect(opts) → page object (Android)
├── ios.js        — iOS API: connect(opts) → page object (WDA over HTTP)
├── usbmux.js     — Node.js usbmuxd client for iOS USB connection
├── ios-cert.js   — WDA cert expiry tracking (7-day free Apple ID certs)
└── setup.js      — Unified setup wizard: Android, iOS from scratch, start WDA, resign cert, teardown

mcp-server.js     — MCP server: JSON-RPC 2.0 over stdio, 10 tools, dual-platform (Android + iOS)
```

13 modules, ~1,800 lines, zero dependencies.

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

148 unit tests + integration tests. All passing.

Run: `node --test test/unit/*.test.js test/integration/*.test.js`

### iOS test plans

Template at `test/ios-test-plan.template.md` — copy per app to `test/plans/[app-name].md`. Includes navigation map (app structure captured upfront), scenarios with verify assertions, edge case handling. Feed to MCP client for agent-driven testing.

iOS tests from Phase 2.7–2.95 (BLE HID era) have been removed. iOS validation is now done via unit tests (`ios.test.js` + `usbmux.test.js`) and manual testing against WDA. Note: iOS is QA-only — WiFi tunnel requires Xcode/Mac for WiFi pairing, USB cable is required on Linux.

## Validation

- Core ADB: 13 E2E flows verified on API 35 emulator
- Termux ADB: POC validated (snapshot + tap + launch via localhost)
- Termux:API: POC validated with Node.js inside Termux (battery, clipboard, volume, wifi, vibrate)
- Termux:API (not yet validated): SMS, calls, location, camera (needs real device)
- iOS WDA: `src/ios.js` — connect, snapshot, tap(ref), type, scroll, swipe, longPress, launch, back, home, screenshot, waitForText, tapXY. Translation layer (`translateWda()`) converts WDA XML → Android node shape → shared prune pipeline. Coordinate-based tap/scroll/longPress from bounds. Hierarchical YAML output identical to Android. Taps use W3C Actions API (not /wda/tap). launch/activate check error responses. MCP server auto-reconnects on WDA death.
