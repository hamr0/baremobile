# iOS Translation Layer — Design Reference

> How iOS snapshots work: WDA XML → Android node shape → shared prune pipeline.

## Problem

WDA's `/source` endpoint returns XML with iOS-specific attributes (`type`, `label`, `name`, `value`, `x`, `y`, `width`, `height`). Android uses a different XML format with different attributes (`class`, `text`, `content-desc`, `bounds`, `clickable`, `scrollable`, etc.). The pruning pipeline (`prune.js`) and YAML formatter (`aria.js`) only understand the Android shape.

Phase 3.0 worked around this with a flat parser (`parseSource`) and custom formatter (`formatSnapshot`). This produced a flat element list — no hierarchy, no shared pruning, no collapse/dedup. Tap used predicate-based element lookup (slow, fragile on duplicate labels).

## Solution: Translation Layer (Phase 3.1)

Single function `translateWda(xml)` that converts WDA XML into the exact node shape that `parseXml()` produces for Android. Once the nodes have the same shape, the shared pipeline handles everything.

```
Android:  ADB XML  →  parseXml()      →  node tree  →  prune()  →  formatTree()  →  YAML
iOS:      WDA XML  →  translateWda()   →  node tree  →  prune()  →  formatTree()  →  YAML
                      ^^^^^^^^^^^^^^
                      only new code
```

## Attribute Mapping

| WDA attribute | → Node field | Notes |
|---|---|---|
| `type` | `class` | Full `XCUIElementType*` — `aria.js` CLASS_MAP maps to short roles |
| `label` | `text` | Primary display text |
| `name` (when label empty) | `contentDesc` | Secondary identifier (accessibility) |
| `value` (on Switch/Toggle) | `checked` | `value="1"` → `checked: true` |
| `x, y, width, height` | `bounds: {x1, y1, x2: x+w, y2: y+h}` | For coordinate-based tap |
| `enabled` | `enabled` | |
| `visible="false"` | skip node entirely | Not rendered — don't include in tree |
| `selected` | `selected` | |
| `focused` | `focused` | |

### Interactive flags (drive ref assignment in `prune()`)

| iOS types | Flag | Effect |
|---|---|---|
| Button, Cell, Link, Tab, Image, Switch, Toggle | `clickable: true` | Gets a ref |
| TextField, SecureTextField, SearchField, TextView | `editable: true` | Gets a ref |
| ScrollView, Table, CollectionView | `scrollable: true` | Gets a ref |

## iOS CLASS_MAP Entries (aria.js)

21 entries added to `CLASS_MAP` for `shortClass()` mapping:

```
XCUIElementTypeButton → Button     XCUIElementTypeStaticText → Text
XCUIElementTypeCell → Cell         XCUIElementTypeSwitch → Switch
XCUIElementTypeTextField → TextInput  XCUIElementTypeSecureTextField → SecureTextInput
XCUIElementTypeSearchField → SearchField  XCUIElementTypeLink → Link
XCUIElementTypeImage → Image       XCUIElementTypeTab → Tab
XCUIElementTypeSlider → Slider     XCUIElementTypeToggle → Toggle
XCUIElementTypeNavigationBar → NavBar  XCUIElementTypeAlert → Alert
XCUIElementTypeTextView → TextInput  XCUIElementTypeTable → List
XCUIElementTypeCollectionView → List  XCUIElementTypeScrollView → ScrollView
XCUIElementTypeApplication → App   XCUIElementTypeWindow → Window
XCUIElementTypeOther → Group
```

## Coordinate-Based Actions

All actions use `boundsCenter(node.bounds)` → `(x, y)` → WDA HTTP endpoint. No predicate lookups, no element ID resolution.

| Action | How |
|---|---|
| `tap(ref)` | bounds center → `POST /session/{sid}/wda/tap` |
| `scroll(ref, dir)` | bounds center ± 1/3 height/width → drag endpoint |
| `longPress(ref)` | bounds center → W3C pointer action with 1s pause |
| `type(ref, text)` | bounds center tap to focus → `POST /session/{sid}/wda/keys` |
| `back()` | search refMap for back button → bounds center tap (or swipe fallback) |

## What Was Removed

Dead code from Phase 3.0 predicate-based approach:
- `findElement()`, `findElements()`, `clickElement()`, `getAttr()`, `getElementType()`, `findByRef()`
- `parseSource()`, `formatSnapshot()`, `INCLUDE_TYPES`, `TYPE_NAMES`, `getXmlAttr()`

## Files Changed

| File | Change |
|---|---|
| `src/ios.js` | `translateWda()`, coordinate actions, imports prune+formatTree |
| `src/aria.js` | 21 iOS entries in `CLASS_MAP` |
| `test/unit/ios.test.js` | 24 tests: translateWda shape, pipeline integration, CLASS_MAP, coordinates |

## Phase 3.2: usbmux + auto-connect

### Problem

pymobiledevice3's port forwarder (`pymobiledevice3 usbmux forward`) crashed regularly with `ValueError: list.remove(x)` — a socket cleanup race condition. Required Python at runtime just for port forwarding.

### Solution: src/usbmux.js

Node.js usbmuxd client (~130 lines, zero deps) that speaks the binary protocol directly to `/var/run/usbmuxd`.

**Protocol details:**
- Header: 16 bytes — `{length (LE32), version (LE32), type (LE32), tag (LE32)}`
- `ListDevices`: version=1, type=8, plist body `<plist><dict><key>MessageType</key><string>ListDevices</string></dict></plist>`
- `Connect`: version=0, type=2, binary payload — `{deviceId (LE32), port (BE16), reserved (LE16)}`
- Port in Connect must be big-endian (network byte order)

**Exports:**
- `listDevices()` — returns `[{deviceId, serialNumber, connectionType}]`
- `connectDevice(deviceId, port)` — returns raw TCP socket to device
- `forward(devicePort, listenPort?)` — TCP proxy server, returns `{port, close()}`

### Auto-discovery in connect()

`src/ios.js connect()` now tries three strategies in order:

1. **Cached WiFi** — reads `/tmp/baremobile-ios-wifi`, tries direct HTTP to WDA
2. **USB discovery** — uses `usbmux.forward()` to create TCP proxy, queries WDA `/status` for WiFi IP, caches it, switches to WiFi direct
3. **Fallback** — `localhost:8100` (legacy manual port forward)

WiFi cache file (`/tmp/baremobile-ios-wifi`) persists across reconnects. Cleared on USB re-discovery if IP changes.

### unlock() improvements

- Detects passcode-required state via `/wda/locked`
- Throws `Error('Device requires passcode but none provided')` if locked without passcode
- Verifies unlock succeeded, throws `Error('Wrong passcode or unlock failed')` on failure
- Usage: `connect({passcode: '1234'})` for automated flows

### WiFi tunnel investigation (WONTFIX)

Investigated whether cable-free iOS is possible on Linux:

- WiFi HTTP traffic to WDA works perfectly (proven — device responds on WiFi IP:8100)
- **Blocker:** WDA process depends on USB tunnel (RemoteXPC) — dies when USB unplugged
- WiFi tunnel requires remote pairing, which requires Xcode "Connect via network" handshake
- Device advertises `_apple-mobdev2._tcp` via mDNS but WiFi lockdown returns `GetProhibited` — pairing is gated by Xcode
- **Conclusion:** Cable-free iOS control is not possible on Linux. iOS = QA tool (USB required). Personal assistant use case = Android only (ADB WiFi works natively)

## Phase 3.3: CLI + MCP Integration

iOS module was working but required throwaway scripts to use. Phase 3.3 wired it into the CLI and MCP server.

### Dual-platform MCP

`mcp-server.js` holds two page slots (`_pages.android` and `_pages.ios`), lazy-created on first use. Every tool accepts optional `platform: "ios"` param (default: android). Dynamic import selects `src/ios.js` or `src/index.js`. On iOS connect, `checkIosCert()` checks `/tmp/baremobile-ios-signed` — if >6 days old or missing, warning prepended to first snapshot.

### CLI --platform flag

`baremobile open --platform=ios` starts iOS daemon. Platform forwarded to daemon child process, stored in `session.json`. Android-only commands (`logcat`, `intent`, `tap-grid`, `grid`) return `{ ok: false, error: 'not available on iOS' }`.

### Setup wizard

`baremobile setup` — interactive, auto-detects what's already done:
- Android: check ADB in PATH, check connected device, guide USB debugging
- iOS: check pymobiledevice3, check USB device via usbmux, check developer mode, check WDA, guide tunnel/DDI/WDA launch, verify connection

### Cert tracking

- `baremobile ios resign` — interactive AltServer signing (Apple ID + password + 2FA prompts)
- `src/ios-cert.js` (~25 lines) — `checkIosCert()` reads `/tmp/baremobile-ios-signed` mtime, warns at >6 days
- `recordIosSigning()` writes timestamp after successful signing

### Files changed

| File | Change |
|------|--------|
| `mcp-server.js` | Dual-platform getPage(), platform param on all tools, cert warning |
| `src/daemon.js` | Dynamic import, skip logcat for iOS, Android-only handler guards, platform in session.json |
| `cli.js` | --platform flag, setup wizard, ios resign/teardown commands |
| `src/ios-cert.js` | NEW — cert expiry check + record |
