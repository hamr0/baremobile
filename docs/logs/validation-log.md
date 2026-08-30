# Validation Log

## v0.8.0 — Code-review fix plan (May 2026)

### Test suite delta

| Snapshot | Tests | Failures |
|---|---|---|
| Start of v0.8.0 work | 94 | 0 |
| After Phase 1+2 | 218 | 0 |
| After necessity proofs | 240 | 0 |
| After Phase 3 | 264 | 0 |
| After Phase 4a | 280 | 0 |
| After Phase 4b | 291 | 0 |
| After Phase 4c (final) | 301 | 0 |

### End-to-end deliverable verification (no device required)

| Check | Method | Result |
|---|---|---|
| Unit suite | `node --test test/unit/*.test.js` | 301/301 PASS |
| Integration suite | `node --test test/integration/*.test.js` | skip cleanly when no device |
| CLI usage | `node cli.js` | PASS — `activate` listed |
| MCP boot | stdio `initialize` + `tools/list` | PASS — 17 tools, all carry `_platforms` arrays |
| Public API imports | `import('./src/{index,ios,errors,apps,debug,daemon}.js')` | PASS — every module loads, exports match spec |
| MCP gate refuses cross-platform call | `tools/call activate platform=android` | PASS — `Tool "activate" is not supported on platform "android". Supported: ios.` |
| `DEBUG_BAREMOBILE=1` traceCall output | child-process roundtrip | PASS — `[baremobile] test demo  ok 8ms` / `…  err Error 0ms` |
| MCP `tap` w/o ref|selector gates with InvalidArgument | live MCP roundtrip | PASS — `Error: tap requires \`ref\` or \`selector\`` |
| Hot-path generic `throw new Error` count | grep `src/{index,ios,interact,apps}.js` | 0 / 0 / 0 / 0 |

### Necessity-proof verdicts (Phase 1+2)

| Fix | Pre-fix bug reproduced? | Verdict |
|---|---|---|
| 1.1 shell injection in `intent()` | ✅ touch sentinel ran via `/bin/sh` | Necessary |
| 1.1 package injection in `launch()` | ✅ same vector via `${pkg}` | Necessary |
| 1.2 iOS connect WDA leak | indirect (mock HTTP server) | Necessary (resource hygiene) |
| 1.3 daemon close race | ❌ did not reproduce on Linux Node 22 | Defensive (Node docs contract) |
| 1.4 WDA fetch timeout | ✅ bare fetch still pending after 1s | Necessary |
| 2.1 parseTimeout NaN | ✅ `Date.now() - start < NaN` always false | Necessary |
| 2.2 iOS back rotation | not reproducible without rotation | Defensive |
| 2.3 logcat unbounded | ✅ 100k naive pushes → 100k entries | Necessary |
| 2.4 wifi-persist IP propagation | ✅ legacy loader returns poisoned ip | Necessary |
| 2.5 find_by_text "null" ambiguity | ✅ string sentinel collides with label | Necessary |
| 2.6 resolvePlatform drift | conceptual (three-literal divergence proof) | Maintainability |

### Stress harness summary

- `phase-stress.test.js`: 21 tests — POSIX shell roundtrip on every printable ASCII + 500 random byte strings + unicode; 20 concurrent iOS `/session`-failing connects; 100 daemon-close cycles; 10 concurrent hung-WDA timeouts; fuzz on parseTimeout / pushBounded / isValidIpv4 / resolvePlatform.
- `phase4b-validation.test.js`: 50-trial randomised maxDepth/maxNodes invariant check on synthetic trees of depth 3-10, width 5-25.

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
