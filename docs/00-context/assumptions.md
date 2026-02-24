# Assumptions, Constraints & Risks

## Assumptions

- Agent has ADB access to the device (USB, WiFi, or Termux localhost)
- Device has Developer Options and USB/Wireless debugging enabled
- Device screen is unlocked (uiautomator requires it)
- `adb` is in PATH on the host machine
- Node.js >= 22 is available

## Constraints

| Constraint | Impact |
|-----------|--------|
| **ADB is the only transport** | Cannot work without ADB (except Termux:API for non-screen actions) |
| **uiautomator dump is slow** | 1-5s per snapshot, limits interaction speed |
| **uiautomator is a global lock** | One dump at a time per device, no parallel snapshots |
| **API 35+ broke text input** | `input text` with spaces fails; word-by-word workaround adds latency |
| **API 35+ broke dump to stdout** | `dump /dev/tty` fails; dump-to-file + cat workaround |
| **WebViews are opaque** | uiautomator tree is empty/shallow inside WebViews |
| **Refs are unstable** | Reset every snapshot, must never be cached across calls |
| **Wireless debugging drops on reboot** | Termux ADB users must re-enable after every restart |
| **No multi-touch** | `adb input` is single-point only |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Google breaks uiautomator in future API | Low | Monitor AOSP, fall back to screenshot + vision |
| ADB protocol changes | Very low | Protocol stable for 10+ years |
| Termux removed from F-Droid | Low | APK can be sideloaded directly |
| Flutter apps crash uiautomator | Medium (known) | Vision fallback: `screenshot()` + `tapXY()` / `tapGrid()` |

## Open questions

- WebView CDP bridge: how reliably can we detect debug-enabled WebViews across apps?
- Multi-touch via `sendevent`: does it work reliably across device vendors?
- Termux:API SMS/calls: validated on emulator (battery, clipboard, volume, wifi, vibrate) but SMS/calls/location/camera need real device testing
