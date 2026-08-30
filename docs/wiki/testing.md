---
type: reference
title: Testing
status: stable
sources: [docs/archive/prd.md]
---

# Testing

## Test suite

baremobile's suite has roughly 186 tests spanning unit and integration coverage (prd.md:483), run with:

```bash
node --test test/unit/*.test.js test/integration/*.test.js
```
(prd.md:485-487)

Unit tests cover each module in isolation (prd.md:489-502):

| File | What |
|------|------|
| `test/unit/xml.test.js` | XML parsing, bounds, entities |
| `test/unit/prune.test.js` | Collapse, keep, drop, dedup, refs, internal name filter |
| `test/unit/aria.test.js` | shortClass mappings, formatTree |
| `test/unit/interact.test.js` | buildGrid, error handling |
| `test/unit/termux.test.js` | Termux detection, device discovery |
| `test/unit/termux-api.test.js` | Module exports, isAvailable, ENOENT |
| `test/unit/ios.test.js` | translateWda, prune pipeline, CLASS_MAP, keyboard/Unicode/path stripping, accessible attr refs, scale factor |
| `test/unit/usbmux.test.js` | usbmuxd protocol, proxy |
| `test/unit/mcp.test.js` | MCP server tools |
| `test/unit/setup.test.js` | Setup wizard helpers, loadPids format parsing, findSdkRoot, findSdkTool |
| `test/unit/cli.test.js` | CLI argument parsing |

Integration tests exercise real components together: `test/integration/connect.test.js` runs end-to-end against an emulator, and `test/integration/cli.test.js` covers CLI session lifecycle. Both auto-skip when no ADB device is available, so the suite still passes in environments without a connected device (prd.md:500-504).

### iOS test plans

Beyond the automated suite, iOS app coverage is driven by written test plans rather than code. A template lives at `test/ios-test-plan.template.md`, copied to `test/plans/[app-name].md` per app, and handed to any MCP client with a prompt like "Read test/plans/whatsapp.md and execute the test plan" (prd.md:506-508). Each plan includes a bundle ID, preconditions, a navigation map (the app's top-level structure, so the agent doesn't waste time exploring), scenarios with steps and verify assertions, and edge cases such as popups, session expiry, and slow network (prd.md:510-512).

## Verified flows

Beyond the automated test suite, specific device flows have been manually verified end to end across all supported platforms and transports.

### Core ADB flows

Verified against a directly-connected Android device: opening an app and reading the screen via `launch()` + `snapshot()`; searching by tapping into a field and typing; navigating back with `press('back')` or `back()`; scrolling long lists; sending a multi-step text message (start chat, type number, tap suggestion, type message, tap send); inserting an emoji (with the agent reading emoji names from contentDesc); dismissing dialogs by reading their text and tapping a button; capturing a screenshot as a PNG buffer with correct magic bytes; toggling Bluetooth and observing switch state transitions (`[checked]`, `[disabled]` transitional, settled); tapping by raw coordinates via `tapXY()` as a vision fallback; and tapping by grid cell via `tapGrid()`, which resolves a cell reference to center coordinates (prd.md:519-534).

### Termux ADB flows

All core ADB flows apply identically over a Termux-hosted ADB connection — same `adb.js`, just a different serial (`localhost:PORT`) (prd.md:536-538). Two flows were verified specifically for this transport: establishing a localhost ADB connection via `adb tcpip` -> `adb forward` -> `adb connect localhost:PORT` -> `connect({termux: true})`, which results in the device being detected; and taking a snapshot through the localhost connection, which produces the same YAML output as over USB ADB (prd.md:540-544).

### Termux:API flows

Four device-integration flows were verified through Termux:API: battery status, returning JSON with percentage, status, and temperature; a clipboard round-trip via `clipboardSet('test')` followed by `clipboardGet()`, returning `"test"`; a volume query returning a JSON array of stream volumes; and WiFi info returning JSON with SSID, BSSID, and signal strength (prd.md:546-553).

### iOS flows

iOS follows the same page-object pattern as Android and was verified on a physical iPhone (prd.md:555-556). Verified flows: taking a snapshot via `connect()` + `snapshot()`, producing hierarchical YAML in the same format as Android; navigating Settings by launching `com.apple.Preferences` and tapping a ref, with navigation performed via coordinate tap; typing in a search field via WDA keys; scrolling via a coordinate-based swipe within element bounds; back navigation, which finds a back button in the ref map or falls back to a swipe-from-left gesture; and capturing a screenshot via the WDA `/screenshot` endpoint (prd.md:558-567).
