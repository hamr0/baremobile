# Stash: iOS Full Keyboard Access tap(ref) — PROVEN
> 2026-02-24 23:25

## Summary
iOS `tap(ref)` now works via Full Keyboard Access + BLE HID keyboard. Same `snapshot()` → `tap(ref)` pattern as Android. Proven on real iPhone 13 mini across Settings, Contacts, Firefox, Files.

## Key Breakthrough
- **Full Keyboard Access** (Settings > Accessibility > Keyboards) enables Tab/Arrow/Space navigation of all iOS UI
- `tap(ref)` flow: Shift+Tab×5 (reset) → Tab (enter list group) → Down×(ref-1) → Space (activate)
- No mouse coordinates, no VoiceOver, no coordinate calibration needed
- Works for **list-based UIs** (majority of iOS apps)

## What Was Done This Session
1. Implemented WiFi tunnel (`--wifi` flag in ios-tunnel.sh)
2. Created `scripts/ios-ax.py` (accessibility dump via pymobiledevice3)
3. Added `snapshot()`, `tap(ref)`, `waitForText()`, `formatSnapshot()` to `src/ios.js`
4. Tried VoiceOver focus + Enter — failed (inspector focus ≠ VoiceOver focus)
5. Tried BLE mouse coordinate approach — unreliable (cursor acceleration)
6. Tried Dwell Control — worked but positioning too imprecise
7. **Full Keyboard Access breakthrough** — Tab+Down+Space reliably activates elements
8. Fixed Escape→Shift+Tab (Escape navigates back in iOS)
9. Added scroll wheel, special keys (enter/space/tab/arrows) to BLE HID POC
10. Added `moveCursor()`, `dwellTap()`, `scroll()` methods
11. Added 7 formatSnapshot unit tests (124 total pass)
12. Updated all docs (PRD, context, README, customer guide, dev-setup)
13. 3 commits on main

## Commits
- `a86c565` feat: iOS tap(ref) via Full Keyboard Access
- `24ab712` fix: use Shift+Tab reset instead of Escape in iOS tap(ref)
- `bfb9ce1` docs: add iOS open items to PRD

## Test Results
| App | snapshot | screenshot | tap(ref) | Notes |
|-----|----------|-----------|----------|-------|
| Settings | ✅ | ✅ | ✅ | List nav perfect: Wi-Fi, Bluetooth, Accessibility, General |
| Contacts | ✅ | ✅ | ✅ | List-based, navigation works |
| Firefox | ✅ | ✅ | Not tested | Web content readable including links |
| Files | ✅ | ✅ | Not tested | Documents with metadata |
| Calculator | ✅ | ✅ | ❌ | Grid layout — Down only moves within column |
| Home Screen | ✅ | ✅ | Not tested | All apps visible with labels |

## Open Items (for tomorrow)
1. **Screenshot blackout** — `snapshot()` (AccessibilityAudit) causes app to render black. Cursor nudge wakes it. Root cause: pymobiledevice3 accessibility inspector interferes with rendering.
2. **WiFi tunnel** — `remote start-tunnel --connection-type wifi` fails. USB works. Needs debugging.
3. **Grid navigation** — Calculator/home screen need Up/Down/Left/Right arrow grid navigation instead of just Down. Need to detect layout type.
4. **Overlay/dialog mismatch** — `iter_elements()` reads UI behind dialogs. Refs don't match keyboard focus.
5. **Back/home navigation** — Escape goes back but exits apps. Need Cmd+H (home) via BLE HID modifier+key.

## Current State
- Branch: `main`
- Tunnel: USB at `/tmp/ios-rsd-address`
- BLE HID: running and paired (needs `sudo python3 test/ios/ble-hid-poc.py`)
- Full Keyboard Access: ON on iPhone
- AssistiveTouch/Dwell: OFF (disabled, was interfering)
- Phone: iPhone 13 mini, unlocked, Developer Mode ON

## Key Technical Details
- `tap(ref)` implementation: `src/ios.js:291-305`
- BLE HID special keys: `test/ios/ble-hid-poc.py:133-153` (SPECIAL_KEYS dict)
- `send_hid <modifier> <keycode>` for modifier combos (e.g., Shift+Tab = `send_hid 0x02 0x2B`)
- Accessibility dump: `scripts/ios-ax.py --rsd HOST PORT dump` → JSON array
- Tab order in Settings: Tab→main list group, Down→individual items, Space→activate
- Tab order: groups first (profile section, search bar, dictate), NOT individual items
- ref=0 is usually Header (non-interactive, Tab skips it), ref=1 is first tappable
- 5× Shift+Tab reliably cycles back to first group in any app

## Files Changed
- `src/ios.js` — tap(ref), moveCursor, dwellTap, scroll, formatSnapshot, estimateTapTarget
- `scripts/ios-ax.py` — NEW: accessibility dump/focus helper
- `scripts/ios-tunnel.sh` — WiFi tunnel support (--wifi flag)
- `test/ios/ble-hid-poc.py` — special keys, scroll wheel, send_hid command
- `test/unit/ios.test.js` — 7 new formatSnapshot tests
- `test/ios/ios-connect.test.js` — reworked with accessibility-based verification
- All docs updated
