# Implementation Log

## 2025-02-24 — Termux:API validation + test coverage audit

- Sideloaded Termux + Termux:API on API 35 emulator
- Validated `termux-*` CLI commands from bash (battery, clipboard, volume, wifi, vibrate)
- Installed Node.js v24.13.0 in Termux, validated `execFile` + `JSON.parse` pattern
- Added 7 unit tests for interact.js error handling (press/tap/scroll/type/longPress)
- Added 4 integration tests (tap by ref, type into search, scroll, swipe)
- Fixed flaky launch() integration test (Settings resumes last activity)
- Restructured obstacle course tables by module (Core ADB, Termux ADB, Termux:API) across all docs
- 94 tests passing (78 unit + 16 integration)

## 2025-02-23 — Termux:API module

- Built `src/termux-api.js` — 16 wrappers for `termux-*` commands
- Pattern: `execFile` → `JSON.parse` for JSON responses, stdin pipe for `smsSend`/`clipboardSet`
- 18 unit tests: exports validation, availability detection, ENOENT errors
- Location has 30s timeout (GPS can be slow)

## 2025-02-23 — Termux ADB bridge

- Built `src/termux.js` — environment detection + localhost ADB setup helpers
- Wired `connect({termux: true})` into index.js with auto-detection
- POC validated on emulator: `adb tcpip` → `adb forward` → `adb connect localhost:PORT`
- Snapshot, tap, launch all work through localhost ADB
- 14 unit tests for detection, parsing, command construction

## 2025-02-22 — Waiting, intents, vision fallback

- `waitForText(text, timeout)` — poll snapshot until text appears
- `waitForState(ref, state, timeout)` — poll for element state changes
- `intent(action, extras?)` — deep navigation via Android intents
- `tapXY`, `tapGrid`, `buildGrid` — screenshot-based vision fallback
- `screenSize()` — device screen dimensions
- XML entity decoding fix (`&amp;` → `&`)

## 2025-02-21 — Core library (Phase 1)

- 6 modules, ~500 lines, zero dependencies
- connect → snapshot → tap/type/press/swipe/scroll/longPress/launch/screenshot
- 36 tests (30 unit + 6 integration)
- XML parser, pruning pipeline, YAML formatter, interaction primitives
