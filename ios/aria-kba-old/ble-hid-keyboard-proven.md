# Stash: BLE HID Keyboard Proven, Mouse Next

**Date:** 2026-02-24
**Branch:** main
**Last commit:** 02d962c — feat: add mouse support back to BLE HID POC, update docs with proven results

---

## What Was Accomplished

### BLE HID Keyboard: PROVEN WORKING
- `send_string hello` → "hello" appears in iPhone Notes app
- Linux (Fedora 43, BlueZ 5.85) → BLE HID GATT server → iPhone 13 mini
- Full pairing, bonding, notification subscription, keystroke delivery confirmed
- Verified with `btmon` — ATT Handle Value Notifications going over the air

### Key Commits This Session
- `eefdcc1` — feat: BLE HID keyboard working — iOS receives keystrokes from Linux via BlueZ
- `5335783` — docs: changelog + implementation log for MCP validation
- `02d962c` — feat: add mouse support back to BLE HID POC, update docs with proven results

---

## Critical Requirements Discovered (iOS BLE HID)

1. **ControllerMode = le** in `/etc/bluetooth/main.conf` — LE-only, prevents Classic BT duplicate entry on iPhone
2. **DisablePlugins = input** in `/etc/bluetooth/main.conf` — prevents BlueZ from claiming HID as local input
3. **KeyboardDisplay agent capability** — iOS requires authenticated pairing (MITM) for HID. `NoInputNoOutput` = unauthenticated = iOS silently refuses to subscribe
4. **LED Output Report in Report Map** — iOS expects to write Caps Lock/Num Lock status
5. **secure-read on Report Map + Report Reference descriptors** — iOS requires encrypted reads for HID
6. **Discoverable = False** — only LE advertisement, not Classic BT discovery
7. **System Python 3.14** for dbus-python/PyGObject (not 3.12 which is for pymobiledevice3)

---

## Current State of POC

**File:** `test/ios/ble-hid-poc.py`
- Keyboard (Report ID 1) + Mouse (Report ID 2) composite Report Map
- LED Output Report under keyboard collection
- PairingAgent with KeyboardDisplay capability
- Interactive stdin via GLib IO watch
- Commands: `send_key <char>`, `send_string <text>`, `click`, `move <dx> <dy>`, `quit`
- Debug logging on all ReadValue, WriteValue, Descriptor reads, and report notifications

**File:** `test/ios/ble-hid.test.js`
- Uses `python3` (system 3.14), not `python3.12`
- 5 tests: dbus bindings, PyGObject, BlueZ version, syntax check, Report Map validation

---

## What's Next

### Immediate: Test Mouse with AssistiveTouch
1. On iPhone: Settings > Accessibility > Touch > AssistiveTouch > ON
2. Start POC: `sudo python3 test/ios/ble-hid-poc.py`
3. Pair iPhone
4. Wait for `Report 2 (MOUSE): notifications ON`
5. Try `move 50 50` then `click`
6. A cursor should appear and clicking should tap

### After Mouse Works: Integration Test
- Screenshot (pymobiledevice3 over USB) → hardcoded tap location → BLE mouse click → screenshot → verify

### Phase 2.9: baremobile-ios JS Module
- Wrap pymobiledevice3 + BLE HID into JS module matching Android API pattern
- `connect()`, `screenshot()`, `tapXY()`, `type()`, `launch()`

---

## Debugging History (Key Failures & Fixes)

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| Two "baremobile" entries on iPhone | Classic BT + LE both advertising | `ControllerMode = le` |
| `notifying=False` despite connection | NoInputNoOutput = unauthenticated | `KeyboardDisplay` agent |
| iOS reads HID Info but not Report Map | Insufficient security level | `KeyboardDisplay` + `secure-read` |
| `No valid service object found` | Invalid flags (encrypt-read) | Use `secure-read`, `notify` |
| stdin readline crash | IOChannel raw mode + readline | Use `sys.stdin` directly |
| Report Map not including LED | iOS expects keyboard LED output | Added LED Output Report |
| Python 3.12 can't import dbus | dbus-python installed for 3.14 | Changed to `python3` (system) |

---

## BlueZ Config State

```ini
# /etc/bluetooth/main.conf
[General]
ControllerMode = le
DisablePlugins = input
```

## Files Modified (6 docs + 1 POC)
- `test/ios/ble-hid-poc.py` — keyboard+mouse composite, pairing agent, debug logging
- `test/ios/ble-hid.test.js` — python3 (not 3.12)
- `baremobile.context.md` — keyboard proven, LE-only requirement
- `docs/01-product/prd.md` — Phase 2.8 keyboard PROVEN, key requirements
- `docs/customer-guide.md` — Module 4 updated, keyboard working
- `docs/00-context/system-state.md` — BLE HID keyboard proven
- `docs/00-context/ios-exploration.md` — spike step 2 done
