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
└── index.js      — Public API: connect(opts) → page object

mcp-server.js     — MCP server: JSON-RPC 2.0 over stdio, 10 tools
```

9 modules, ~1,000 lines, zero dependencies.

## What's built

| Phase | Status | What |
|-------|--------|------|
| 1.0 Core library | DONE | connect, snapshot, tap/type/press/swipe/scroll/longPress/launch/screenshot |
| 1.5 Vision fallback | DONE | tapXY, tapGrid, buildGrid, screenSize, XML entity decoding |
| 1.6 Waiting + intents | DONE | waitForText, waitForState, intent() |
| 2.0 Termux ADB | DONE | isTermux, findLocalDevices, adbPair/Connect, connect({termux: true}) |
| 2.5 Termux:API | DONE | 16 wrappers: SMS, calls, location, camera, clipboard, battery, volume, etc. |

## What's next

| Phase | Status | What |
|-------|--------|------|
| 2.7 iOS pymobiledevice3 spike | DONE | Screenshots, app launch/kill, device info from Linux over USB. 8 iOS tests. |
| 2.8 iOS BLE HID input spike | IN PROGRESS | BLE keyboard/mouse input to iPhone via BlueZ D-Bus GATT server |
| 3 MCP server | DONE | JSON-RPC 2.0 over stdio, 10 tools (same pattern as barebrowse) |
| 4 CLI session mode | TODO | cli.js + daemon.js + session-client.js |
| 5 bareagent adapter | TODO | createMobileTools() → {tools, close} for bareagent Loop |
| 6 WebView CDP bridge | TODO | Attach CDP to debug-enabled WebViews |
| 7 Advanced interactions | TODO | pinch, drag, clipboard, notification shade |

## Tests

109 tests (93 unit + 16 integration), 7 test files. All passing.

Run: `node --test test/unit/*.test.js test/integration/*.test.js`

iOS tests (separate, require iPhone + USB): 8 tests in `test/ios/screenshot.test.js`.

Run: `npm run test:ios`

## Validation

- Core ADB: 13 E2E flows verified on API 35 emulator
- Termux ADB: POC validated (snapshot + tap + launch via localhost)
- Termux:API: POC validated with Node.js inside Termux (battery, clipboard, volume, wifi, vibrate)
- Termux:API (not yet validated): SMS, calls, location, camera (needs real device)
- iOS pymobiledevice3: 8/8 tests passing — screenshots, app launch/kill, device info (Fedora 43, iPhone 13 mini)
- iOS BLE HID: spike in progress — adapter validated (Intel 9460/9560, peripheral role supported)
