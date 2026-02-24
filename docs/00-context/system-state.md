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
└── ios.js        — iOS API: connect(opts) → page object (pymobiledevice3 + BLE HID)

mcp-server.js     — MCP server: JSON-RPC 2.0 over stdio, 10 tools

scripts/
├── ios-tunnel.sh  — iOS bridge: USB/WiFi tunnel + BLE HID
└── ios-ax.py      — iOS accessibility: dump elements + focus navigation
```

10 modules, ~1,200 lines, zero dependencies.

## What's built

| Phase | Status | What |
|-------|--------|------|
| 1.0 Core library | DONE | connect, snapshot, tap/type/press/swipe/scroll/longPress/launch/screenshot |
| 1.5 Vision fallback | DONE | tapXY, tapGrid, buildGrid, screenSize, XML entity decoding |
| 1.6 Waiting + intents | DONE | waitForText, waitForState, intent() |
| 2.0 Termux ADB | DONE | isTermux, findLocalDevices, adbPair/Connect, connect({termux: true}) |
| 2.5 Termux:API | DONE | 16 wrappers: SMS, calls, location, camera, clipboard, battery, volume, etc. |
| 2.9 iOS module | DONE | `src/ios.js`: connect → page object with screenshot/launch/kill/tapXY/type/press/swipe/back/home. Unified setup script, live speed test. |
| 2.95 iOS cable-free | DONE | WiFi tunnel (`--wifi` flag), accessibility snapshot (`scripts/ios-ax.py`), `waitForText()`, `tap(ref)` via Full Keyboard Access (Tab+Down+Space). Cable-free: WiFi + Bluetooth. Same `snapshot()` → `tap(ref)` pattern as Android. |

## What's next

| Phase | Status | What |
|-------|--------|------|
| 2.7 iOS pymobiledevice3 spike | DONE | Screenshots, app launch/kill, device info from Linux over USB. 8 iOS tests. |
| 2.8 iOS BLE HID input spike | DONE | BLE keyboard + mouse + combo proven, integration 6/6 passing |
| 3 MCP server | DONE | JSON-RPC 2.0 over stdio, 10 tools (same pattern as barebrowse) |
| 4 CLI session mode | DONE | cli.js + daemon.js + session-client.js |
| 5 bareagent adapter | TODO | createMobileTools() → {tools, close} for bareagent Loop |
| 6 WebView CDP bridge | TODO | Attach CDP to debug-enabled WebViews |
| 7 Advanced interactions | TODO | pinch, drag, clipboard, notification shade |

## Tests

150 tests (134 unit + 16 integration), 8 test files. All passing.

Run: `node --test test/unit/*.test.js test/integration/*.test.js`

iOS tests (separate, require iPhone + tunnel): 8 tests in `test/ios/screenshot.test.js`, 6 tests in `test/ios/ble-hid.test.js`, 6 tests in `test/ios/integration.test.js`, 7 tests in `test/ios/ios-connect.test.js`.

Run: `npm run test:ios`

## Validation

- Core ADB: 13 E2E flows verified on API 35 emulator
- Termux ADB: POC validated (snapshot + tap + launch via localhost)
- Termux:API: POC validated with Node.js inside Termux (battery, clipboard, volume, wifi, vibrate)
- Termux:API (not yet validated): SMS, calls, location, camera (needs real device)
- iOS pymobiledevice3: 8/8 tests passing — screenshots, app launch/kill, device info (Fedora 43, iPhone 13 mini)
- iOS BLE HID: keyboard proven, mouse proven, combo proven, integration 6/6 passing
- iOS module: `src/ios.js` — connect, screenshot, snapshot, tap(ref), waitForText, launch, kill, tapXY, type, press, swipe, back, home, longPressXY
- iOS cable-free: WiFi tunnel (pymobiledevice3 remote start-tunnel), accessibility dump (iter_elements), tap(ref) via Full Keyboard Access (Escape→Tab→Down×N→Space through BLE HID keyboard). No mouse coordinates, no VoiceOver.
