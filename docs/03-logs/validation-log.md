# Validation Log

## Core ADB — API 35 emulator (February 2025)

| Flow | Result |
|------|--------|
| Open app + read screen | PASS — clean YAML with refs |
| Search by typing | PASS — type "wifi", results appear |
| Navigate back/home | PASS |
| Scroll long lists | PASS — new items visible after scroll |
| Send SMS | PASS — full multi-step flow |
| Insert emoji | PASS — emoji inserted via contentDesc |
| File attachment | PASS — picker navigated, file selected |
| Dismiss dialogs | PASS — read text, tap OK |
| Toggle Bluetooth | PASS — full off/on cycle with transitional states |
| Screenshot capture | PASS — PNG with correct magic bytes |
| Tap by coordinates | PASS — tapXY(540, 1200) |
| Tap by grid cell | PASS — tapGrid('E10') |
| Intent deep nav | PASS — direct to Bluetooth settings |

## Termux ADB — API 35 emulator (February 2025)

| Flow | Result |
|------|--------|
| Localhost ADB connection | PASS — `adb connect localhost:PORT` |
| Snapshot via localhost | PASS — same YAML as USB ADB |
| Launch + tap + home | PASS — all interactions work |

## Termux:API — API 35 emulator, Node.js in Termux (February 2025)

| Command | Bash POC | Node.js POC |
|---------|----------|-------------|
| batteryStatus | PASS — JSON | PASS — execFile + JSON.parse |
| clipboardGet/Set | PASS | PASS |
| volumeGet | PASS — 6 streams | PASS |
| wifiInfo | PASS — JSON | PASS |
| vibrate | PASS | PASS |
| smsSend | NOT TESTED — no SIM | NOT TESTED |
| call | NOT TESTED — no SIM | NOT TESTED |
| location | NOT TESTED — no GPS | NOT TESTED |
| cameraPhoto | NOT TESTED — no camera | NOT TESTED |
| contactList | NOT TESTED — empty | NOT TESTED |

## iOS pymobiledevice3 — iPhone 13 mini, Fedora 43 (February 2026)

8/8 tests passing. Python 3.12, pymobiledevice3 7.7.2, iPhone 13 mini (iOS 18, build 23D127).

| Flow | Result |
|------|--------|
| Device detection via usbmux | PASS — returns model, iOS version, UDID |
| Lockdown info dump | PASS — CPU arch, WiFi MAC, serial, carrier |
| Developer mode status check | PASS — `reveal-developer-mode` makes toggle visible |
| Developer image mount | PASS — auto-downloads + mounts personalized image via Apple TSS |
| Screenshot capture | PASS — PNG, ~35 KB home screen, ~463 KB in-app, avg 2.5s |
| Process list | PASS — full process tree, 1 MB+ output |
| App launch by bundle ID | PASS — returns PID |
| App kill by PID | PASS |

## iOS BLE HID — iPhone 13 mini, Fedora 43, BlueZ 5.85 (February 2026)

All capabilities proven. Integration 6/6 passing.

| Flow | Result |
|------|--------|
| BLE HID keyboard — type text into Notes | PASS — `send_string hello` → text appears |
| BLE HID combo — keyboard + mouse subscribe simultaneously | PASS — fixed Report ID + Appearance bugs |
| BLE HID mouse — cursor movement + click via AssistiveTouch | PASS — tap at coordinates confirmed |
| Home cursor to top-left corner | PASS — rapid small-step reports (10 units, 8ms interval) |
| Integration: screenshot → BLE tap Wi-Fi → screenshot → verify navigation | PASS |
| Integration: navigate to search bar → BLE type → screenshot → verify text | PASS |

### Bugs fixed during validation

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Two "baremobile" entries on iPhone | Classic BT + LE both advertising | `ControllerMode = le` |
| `notifying=False` despite connection | `NoInputNoOutput` agent | `KeyboardDisplay` agent |
| iOS reads HID Info but not Report Map | Insufficient security level | `secure-read` on Report Map + Report Reference |
| Keyboard drops when mouse connects | LED Output Report Reference had Report ID 0 | Fixed to match keyboard collection (Report ID 1) |
| Keyboard drops when mouse connects | Appearance `0x03C1` (Keyboard) | Changed to `0x03C0` (Generic HID) |
| Mouse moves tiny amount | iOS clamps single-report movement | Rapid small-step reports (10 units, 8ms intervals) |

## Automated test suite

109 tests (93 unit + 16 integration), all passing.
Run: `node --test test/unit/*.test.js test/integration/*.test.js`

iOS tests (separate, require iPhone + USB + BT): 20 tests across 3 files.
Run: `npm run test:ios`
