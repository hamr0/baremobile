# Decisions Log

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

## bareagent comes last
**When:** Roadmap restructuring
**Decision:** Development order: core → termux → termux adb → MCP → CLI → bareagent → multis.
**Why:** bareagent absorbs all three capability layers into one tool set. All must be complete first. multis consumes baremobile through bareagent.
