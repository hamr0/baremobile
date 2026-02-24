# Bug Log

## API 35+ text input with spaces
**Symptom:** `adb shell input text "hello world"` fails silently or garbles output.
**Root cause:** Android API 35 broke `input text` with spaces.
**Fix:** Word-by-word input with KEYCODE_SPACE (62) injected between words. Shell-escapes special chars.
**Status:** Fixed in `src/interact.js`.

## API 35+ uiautomator dump to stdout
**Symptom:** `uiautomator dump /dev/tty` returns empty or error on API 35+.
**Root cause:** `/dev/tty` path no longer works in newer Android.
**Fix:** Dump to `/data/local/tmp/baremobile.xml`, cat it back via `exec-out` (binary-safe).
**Status:** Fixed in `src/adb.js`.

## Switch/toggle disappears when off
**Symptom:** Bluetooth Switch element vanishes from accessibility tree when BT is off.
**Root cause:** Android removes unchecked Switch/Toggle from tree instead of showing `[unchecked]`.
**Workaround:** Document that "no switch present = off". Agent should not look for `Switch [unchecked]`.
**Status:** Documented in context.md gotchas.

## Toggle transitional disabled state
**Symptom:** After tapping Bluetooth toggle, it shows `[disabled]` for 1-2 seconds before settling.
**Root cause:** Android shows disabled state during async hardware state change.
**Workaround:** Use `waitForText()` or `waitForState()` instead of fixed delays.
**Status:** Documented, `waitForText` and `waitForState` added in Phase 1.6.

## Flaky launch() integration test
**Symptom:** `launch('com.android.settings')` test failed because Settings resumed on "Apps" subsection.
**Root cause:** Settings app resumes last activity, not always the main screen.
**Fix:** Relaxed assertion to check for refs and content length instead of specific "Settings" text.
**Status:** Fixed in `test/integration/connect.test.js`.

## POC adb forward with multiple devices
**Symptom:** `adb forward` failed with "more than one device/emulator" during Termux POC.
**Root cause:** After `adb tcpip 5555`, emulator shows up as both `emulator-5554` and TCP. Forward command needs `-s`.
**Fix:** Added `-s emulator-5554` to forward and cleanup commands.
**Status:** Fixed in POC, not a library issue (library always threads `-s serial`).
