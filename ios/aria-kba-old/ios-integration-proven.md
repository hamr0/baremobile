# Stash: iOS Integration Loop Proven

**Date:** 2026-02-24
**Branch:** main
**Last commit:** 02d962c (before this session's changes)

---

## What Was Accomplished

### Full iOS Integration Loop: PROVEN
- Screenshot (pymobiledevice3 USB) → BLE mouse tap → screenshot → BLE keyboard type → screenshot
- 6/6 integration tests passing in ~40s
- Test: `test/ios/integration.test.js`

### BLE HID Bugs Fixed
1. **LED Output Report Reference ID was 0, should be 1** — caused iOS to drop keyboard when mouse connected
2. **Advertisement Appearance was `0x03C1` (Keyboard)** — changed to `0x03C0` (Generic HID) for combo device
3. **Mouse movement too small** — iOS clamps single-report movement; fixed by sending rapid small-step reports (STEP=10, 8ms interval)

### Key Findings
- iOS hides software keyboard when BLE keyboard connected — expected behavior, benefits automation (more screen visible)
- AssistiveTouch cursor starts at center of screen on new connection
- Mouse requires rapid small-step reports like a real mouse sensor (125Hz polling)
- `pkexec` needed instead of `sudo` for spawning BLE POC from Node.js tests (graphical auth prompt)
- usbmuxd pair record can go stale — may need re-trust on iPhone

---

## Files Changed

### Modified
- `test/ios/ble-hid-poc.py` — LED Report ID fix (0→1), Appearance fix (0x03C1→0x03C0), multi-step mouse movement
- `docs/01-product/prd.md` — Phase 2.8 updated: combo proven, mouse proven, integration proven, critical requirements table
- `docs/00-context/ios-exploration.md` — spike steps updated, bug table added, iOS behaviors documented

### Created
- `test/ios/integration.test.js` — 6 tests: launch Settings, BLE HID connect, home cursor, tap Wi-Fi, verify change, type text

---

## Current State

### All Blocks Proven

| Block | Status | Test |
|-------|--------|------|
| pymobiledevice3 screenshots | DONE | 8/8 |
| pymobiledevice3 app lifecycle | DONE | 8/8 |
| BLE HID keyboard | PROVEN | manual + integration |
| BLE HID mouse | PROVEN | manual + integration |
| Full integration loop | PROVEN | 6/6 |

### Phase 2.8 Complete — What's Next

**Phase 2.9: baremobile-ios JS module**
- Wrap pymobiledevice3 + BLE HID into JS module matching Android API pattern
- `connect()`, `screenshot()`, `tapXY()`, `type()`, `launch()`
- Key design: `tapXY()` homes cursor to (0,0) then moves to target

**Phase 2.10: Vision-based QA module**
- screenshot → LLM → "find the login button" → tap coordinates → verify

---

## Running the Integration Test

```bash
# Terminal 1: Start tunnel
./scripts/ios-tunnel.sh
# Or manually:
pkexec env PYTHONPATH=$HOME/.local/lib/python3.12/site-packages python3.12 -m pymobiledevice3 lockdown start-tunnel
# Write RSD: echo "<host> <port>" > /tmp/ios-rsd-address

# Terminal 2: Run test (NOT with sudo — test uses pkexec internally for BLE POC)
node --test test/ios/integration.test.js
```

### Prerequisites
- iPhone paired with "baremobile" BLE device (Settings > Bluetooth)
- AssistiveTouch enabled (Settings > Accessibility > Touch > AssistiveTouch)
- Developer image mounted
- BlueZ config: `ControllerMode = le`, `DisablePlugins = input`
