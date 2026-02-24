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

## Automated test suite

94 tests (78 unit + 16 integration), all passing.
Run: `node --test test/unit/*.test.js test/integration/*.test.js`
