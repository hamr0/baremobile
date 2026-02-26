# Stash: iOS Phase 2.9 — BLE HID Module + Accessibility Discovery

**Date:** 2026-02-24
**Branch:** main (commit e0082f3 + uncommitted fixes)

## What Was Built

### src/ios.js (~250 lines)
- `connect()` → page object with `platform: 'ios'`
- Screenshot via pymobiledevice3 `developer dvt screenshot`
- `launch(bundleId)` → returns PID, `kill(pid)`
- `tapXY(x, y)`, `type(text)`, `press(key)`, `swipe()`, `back()`, `home()`, `longPressXY()`
- `BleHidDaemon` class — lazy singleton, spawns `ble-hid-poc.py`, root handling via pkexec
- RSD tunnel resolution: env var → `/tmp/ios-rsd-address` file → `remote browse`

### scripts/ios-tunnel.sh (modified)
- Added BLE HID startup, `stop` subcommand, PID files, `--no-ble` flag
- Fixed: `sudo true` before backgrounding (credentials caching)
- Fixed: `| tee` for log capture + RSD auto-parsing
- Known issue: RSD auto-write timing can miss — falls back to manual `echo 'HOST PORT' > /tmp/ios-rsd-address`

### scripts/ios-live-test.js (new)
- Interactive speed test measuring real latency for all iOS operations

### Tests
- `test/unit/ios.test.js` — 14 unit tests (RSD parsing, PID parsing, BLE command sequences)
- `test/ios/ios-connect.test.js` — 7 integration tests, saves screenshots to `.screenshots/`
- All 143 tests passing (existing 109 + 14 new iOS unit + 20 existing iOS)

### package.json
- Added `"./ios": "./src/ios.js"` export

## Key Discovery: Accessibility API

**This changes everything.** pymobiledevice3 has `developer accessibility` commands:

```python
from pymobiledevice3.services.accessibilityaudit import AccessibilityAudit

with AccessibilityAudit(rsd) as a:
    for el in a.iter_elements():
        print(el.caption)  # "Wi-Fi, vanCampers, Button"
    a.perform_press(element)  # tap by reference, no coordinates
```

### What `iter_elements()` returns per element:
- `caption` — visible text + role: "Wi-Fi, vanCampers, Button"
- `spoken_description` — VoiceOver label
- `platform_identifier` — unique hex ID for `perform_press()`
- `element` — raw bytes for API calls

### Available methods on AccessibilityAudit:
- `iter_elements()` — walk every UI element on current screen
- `perform_press(element)` — tap element by reference (no coordinates!)
- `move_focus()` / `move_focus_next()` — navigate focus
- `settings` / `set_setting()` — accessibility settings
- `set_show_ignored_elements()` — include hidden elements

### Capabilities (from deviceCapabilities):
- `deviceCurrentState` — get UI state
- `deviceElement:performAction:withValue:` — perform actions on elements
- `deviceFetchElementAtNormalizedDeviceCoordinate:` — get element at point
- `deviceRunningApplications` — list running apps
- `deviceInspectorEnable:` / `deviceInspectorFocusOnElement:` — inspect elements

### What this means:
- **No screenshots needed for navigation** — accessibility tree gives full UI state
- **No BLE mouse needed for tapping** — `perform_press()` taps by reference
- **BLE keyboard still needed for typing** — no accessibility API for text input
- **Same pattern as Android** — `snapshot()` → element tree, `tap(ref)` → press element

## Verified on Device
- iPhone 13 mini, iOS 26.3
- Tunnel: `fd65:b9a5:dee::1 63663` (changes each restart)
- BLE HID paired as "baremobile"
- Accessibility dump of home screen: 25 elements (all apps + search)
- Accessibility dump of Settings: 33+ elements (all rows with labels and states)

## Uncommitted Changes
- `scripts/ios-tunnel.sh` — sudo + tee fixes
- `test/ios/ios-connect.test.js` — screenshot-saving + assertScreenChanged
- `.screenshots/` — 8 test screenshots from last run

## Next: Rework Plan
Rework `src/ios.js` around accessibility API:
- `snapshot()` → calls `iter_elements()`, returns structured tree
- `tap(ref)` → calls `perform_press(element)` by reference
- `type(text)` → still BLE keyboard
- Keep BLE mouse as fallback for coordinate-based ops (tapXY, swipe)
- Two modes: "ios" (full, accessibility) and "ios-ble" (mouse+keyboard only)
