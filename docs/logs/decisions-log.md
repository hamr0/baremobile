# Decisions Log

## v0.8.0 — Code-review fix plan

### Typed error hierarchy with `.code` + cause preservation
**When:** Phase 4.1
**Decision:** Introduce `src/errors.js` with a `BaremobileError` base and concrete subclasses (`ElementNotFound`, `SelectorNotFound`, `WdaTimeout`, `WdaUnavailable`, `WaitTimeout`, `InvalidArgument`, `DeviceError`). Each sets `.name` and `.code` matching the class name and preserves the original error via `.cause`.
**Why:** MCP retry tiers and library users were substring-matching `err.message` against fragile strings like `'fetch failed'` / `'UND_ERR'` / `'ECONNRESET'`. Typed errors give callers a single discriminator (`err.code` or `instanceof`) and let `isConnectionError(err)` be the only place that needs updating when the underlying runtime error vocabulary shifts.

### Selectors layered ON TOP of refs, not instead of
**When:** Phase 4.2
**Decision:** `page.tap`/`type`/`scroll`/`longPress` accept `refOrSelector`. A string/number is a ref (existing behaviour, no snapshot). An object `{text|contentDesc}` triggers a fresh snapshot, substring-matches via `findByText`, then routes to the ref path.
**Why:** Refs remain the canonical, snapshot-bound identifier so existing code keeps working. Selectors are pure agent-convenience sugar — they cost a snapshot per call, which is the price of "act on what you describe, not what you indexed."

### `platform: 'auto'` is async + cached
**When:** Phase 4.4
**Decision:** `resolvePlatformAsync` probes ADB then usbmuxd on the first call with `platform: 'auto'`, caches the result for the process lifetime. A synchronous `resolvePlatform` honours the cache for retry tiers that can't await without a wider refactor.
**Why:** Probe cost is bounded (one-time, two cheap subprocess/socket calls). Refactoring the retry tiers to async would require touching every error handler — out of scope for v0.8.0. Cache lifetime is "until process exit" because devices rarely hot-swap mid-session.

### Atomic file writes via rename(2)
**When:** Phase 3.6
**Decision:** `atomicWriteFileSync(path, contents)` writes to `<path>.tmp` then `renameSync()`s over the target.
**Why:** POSIX `rename(2)` is atomic on the same filesystem. Concurrent readers (the parent daemon poll loop) see either the previous file or the fully-written new one — never partial bytes. Cheaper and simpler than file locking.

### MCP `_platforms` annotation as the gate, not just metadata
**When:** Phase 2.7 + 4.6
**Decision:** Every MCP tool carries a `_platforms: ['android'|'ios'][]` array. `handleToolCall` refuses cross-platform calls before reaching `getPage()`, returning a clear `"Tool X is not supported on platform Y"` error.
**Why:** Without this, an iOS call to an Android-only tool produced a confusing "method not on page" error from deep inside the page object. The gate also makes platform support discoverable from the tool description (`[android-only]` / `[ios-only]` prefix).

### Necessity proofs in the test suite
**When:** Phase 1+2, mid-flight standing rule
**Decision:** For each fix, write an inline test that reproduces the pre-fix buggy behaviour and demonstrates the fix changes the outcome. If a fix turns out unnecessary on this host (e.g. Phase 1.3 daemon close race didn't manifest on Linux Node 22), document that and decide explicitly whether to retain on contract grounds.
**Why:** Pure regression tests prove a fix works; they don't prove it was *needed*. Necessity tests catch dead complexity early — three Phase 1+2 fixes were re-examined and one was downgraded to "defensive" status with a documented justification.

## ADB direct, not Appium
**When:** Phase 1 design
**Decision:** Use `child_process.execFile('adb', ...)` directly, no Appium.
**Why:** No Java server, no driver install, no 500MB of deps. ADB is already there. Same zero-dep philosophy as barebrowse.

## uiautomator, not AccessibilityService
**When:** Phase 1 design
**Decision:** Use `uiautomator dump` for accessibility tree, not a custom AccessibilityService APK.
**Why:** Works without app modification. No need to install a helper APK on the device.

## YAML output, not JSON
**When:** Phase 1 design
**Decision:** Format snapshots as indented YAML-like text, not JSON.
**Why:** Token-efficient, agents already know the format from barebrowse. YAML is ~40% fewer tokens than equivalent JSON.

## Refs reset per snapshot
**When:** Phase 1 design
**Decision:** Ref numbers are assigned fresh each snapshot. Never stable across calls.
**Why:** Stable refs would require diffing and tracking. Complexity for minimal gain since agents should always snapshot before acting.

## Word-by-word typing
**When:** Phase 1, API 35 testing
**Decision:** Split text into words, type each with `input text`, inject KEYCODE_SPACE between.
**Why:** `input text "hello world"` is broken on API 35+. Word-by-word is the only reliable method.

## Android only, no iOS
**When:** Phase 1, research phase
**Decision:** Focus exclusively on Android. No iOS support planned.
**Why:** Android is open (USB debugging exposes everything). iOS gates equivalent access behind Mac + Xcode + sideload + certificate management. Not a technical problem we can solve — platform policy. See `00-context/ios-exploration.md` for full analysis.

## Termux is not a separate transport
**When:** Phase 2 design
**Decision:** Termux ADB uses the same `adb.js` with serial `localhost:PORT`. Not a new transport layer.
**Why:** All existing code works unchanged. The serial is just different. `termux.js` is a setup helper, not a transport.

## Termux:API as separate module
**When:** Phase 2.5 design
**Decision:** `termux-api.js` is independent from ADB. No screen control, direct API access only.
**Why:** Different use case. Agent might just need to "send a text" without touching the screen. Complements ADB, doesn't replace it.

## MCP tools: 10 screen-control only, Termux:API excluded
**When:** Phase 3 design
**Decision:** MCP server exposes 10 screen-control tools only. No Termux:API, no tapXY/tapGrid, no intent, no waitFor*.
**Why:** Screen control is the core use case for MCP clients (Claude Code/Desktop). Termux:API is a separate concern (Termux-only, different audience). tapXY/tapGrid are vision fallbacks (agent should use refs). waitFor* is agent-side logic. intent is too low-level for most agents. Keep it focused — add more tools later if needed.

## iOS via BLE HID + pymobiledevice3
**When:** Phase 2.7–2.8 (February 2026)
**Decision:** Support iOS via BLE HID (input) + pymobiledevice3 (output). Reverses the Phase 1 "Android only, no iOS" decision.
**Why:** BLE HID proves Mac-free iOS control from Linux. Zero deps on the phone — no app install, no signing, no jailbreak. Standard Bluetooth hardware. Vision-based automation (screenshot → LLM → BLE tap). pymobiledevice3 gives screenshots/app lifecycle over USB without Apple Developer account. Architecture C from ios-exploration.md is now fully proven: keyboard, mouse, combo, integration 6/6 passing.

## bareagent comes last
**When:** Roadmap restructuring
**Decision:** Development order: core → termux → termux adb → MCP → CLI → bareagent → multis.
**Why:** bareagent absorbs all three capability layers into one tool set. All must be complete first. multis consumes baremobile through bareagent.
