# Bug Log

## v0.8.0 — Code-review fix plan

### Shell injection in `page.launch(pkg)` and `page.intent(action, extras)`  [1.1]
**Symptom:** A user-supplied package name like `com.x; touch /tmp/pwned; #` would run `touch` on the device. Same for intent string extras containing `'`.
**Root cause:** `shell(\`am start … ${pkg}\`)` builds an `adb shell` string and `adb shell` re-parses on the device. Single-quote wrapping `'${v}'` failed when `v` itself contained `'`.
**Fix:** `validatePackage`, `validateIntentAction`, `validateExtraKey` regex-gate dotted identifiers. `shellQuote()` uses the POSIX `'\''` idiom for any free-form value. Necessity reproduced inline via `/bin/sh -c` and verified with 500 random-byte roundtrips.

### iOS connect() leaked WDA session + usbmuxd tunnel on failure  [1.2]
**Symptom:** A failed `/session` POST left the usbmuxd forwarder running forever.
**Root cause:** Post-`/session` bring-up wasn't try/catch wrapped.
**Fix:** Wrap from `wdaPost('/session', ...)` through the screen-size probe in `try { … } catch (e) { cleanup(); throw e; }`.

### Daemon close response raced process.exit()  [1.3]
**Symptom:** CLI `close` occasionally returned `ECONNRESET` instead of the JSON body.
**Root cause:** `res.end(body); server.close(); process.exit(0)` doesn't wait for socket flush.
**Fix:** `res.end(body, () => server.close(() => process.exit(0)))`. Race did not reproduce on Linux Node 22 across 10 trials — fix retained on Node-documented contract grounds.

### WDA fetch had no timeout  [1.4]
**Symptom:** A hung WDA (common after iOS lock) parked MCP tool calls indefinitely.
**Root cause:** `fetch(url)` with no signal.
**Fix:** `AbortSignal.timeout(BAREMOBILE_WDA_TIMEOUT_MS ?? 10_000)` per attempt; surfaces as typed `WdaTimeout`. Bare-fetch hang verified to last >1s; AbortSignal version returns in <1s.

### `wait-text` / `wait-state` silently exited on malformed timeout  [2.1]
**Symptom:** `wait-text … --timeout=abc` returned "timeout" instantly.
**Root cause:** `Number("abc") === NaN`, then `Date.now() - start < NaN` is always false.
**Fix:** `parseTimeout()` rejects non-decimals.

### iOS back() used cached screen height after rotation  [2.2]
**Symptom:** Edge-swipe back gesture landed off-screen in landscape.
**Root cause:** `_screenH` was read once at connect time.
**Fix:** Re-query `/window/size` inside the swipe-fallback branch only (no per-call cost for the navbar-button path).

### Logcat grew unbounded  [2.3]
**Symptom:** Long-lived daemons leaked memory + slowed `logcat` retrieval.
**Root cause:** `logcatEntries.push(line)` with no cap.
**Fix:** `pushBounded(arr, line, max=50_000, trim=1_000)` — amortised O(1) trimming.

### wifi-device.json propagated poisoned IPs  [2.4]
**Symptom:** A corrupt config could feed garbage into `adb connect`.
**Root cause:** `JSON.parse(...)` + `return` with no validation.
**Fix:** `isValidIpv4()` + port range check; corrupt records are deleted.

### MCP find_by_text returned `"null"` literal  [2.5]
**Symptom:** A label that read "null" was indistinguishable from a miss.
**Fix:** Return structured JSON `{found: bool, ref?: string}`.

### MCP retry tiers used divergent platform defaults  [2.6]
**Symptom:** Maintainability — three call sites repeated `args.platform || 'android'`; drift could clear the wrong cache.
**Fix:** `resolvePlatform()` / `resolvePlatformAsync()` helper.

### Atomic session.json write  [3.6]
**Symptom:** Parent poll loop could (rarely) read a half-written session.json.
**Fix:** `atomicWriteFileSync()` — write to `.tmp`, then `rename(2)`.

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
