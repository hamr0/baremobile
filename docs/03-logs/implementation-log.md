# Implementation Log

## 2026-05-18 — v0.8.0: Code-review fix plan landed across 7 commits

Plan: `docs/02-features/code-review-fixes.md`.

Commits (oldest first, all on `main`):

- `404e8ba fix: Phase 1+2 — critical security + correctness`
  Shell-injection blockers (1.1), iOS connect cleanup (1.2), daemon close-flush (1.3), WDA fetch timeout (1.4), parseTimeout (2.1), iOS back rotation (2.2), bounded logcat (2.3), wifi-persist validation (2.4), structured find_by_text (2.5), resolvePlatform (2.6), MCP platform annotations (2.7). +14 files / +1294 lines / -64.
- `f5a2669 test: necessity proofs for Phase 1+2 fixes`
  10 inline reproductions of pre-fix behaviour. Verdict: 8/11 fixes field-reproducible bugs; 2 defensive (contract-driven); 1 maintainability. No rollbacks.
- `1899ffd fix: Phase 3 — cleanup + iOS activate exposure`
  iOS activate (3.1), dead col-check (3.2), stale comments (3.3, 3.4), atomic session.json (3.6). +7 files / +253 lines / -10.
- `68e6127 feat: Phase 4a — typed errors, platform:'auto', DEBUG_BAREMOBILE`
  New `src/errors.js`, `src/debug.js`. MCP retry tiers migrated to `isConnectionError`. +10 files / +445 lines / -53.
- `8bf88ae feat: Phase 4b — selector-based actions, waitForStable, bounded snapshot`
  Forward-declared `let page` on iOS to let resolveSelector close over it. `prune` gains `maxDepth/maxNodes` + `truncated` flag. New `wait_stable` MCP tool. +6 files / +467 lines / -44.
- `d606477 feat: Phase 4c — app helpers + multi-device`
  New `src/apps.js` (4 helpers, all validated). `_pages` keyed by `pageKey(platform, serial)`. PLATFORM_PROP gains a `serial` arg surfaced on every tool. +6 files / +323 lines / -31.
- *(this commit)* `chore: Phase 5 — docs + version bump`
  CHANGELOG, bug/decisions/implementation/validation logs, system-state, PRD, version 0.8.0.

Standing rule established mid-flight: **validate each claim at HEAD before fixing; necessity-test each fix; auto-fix anything that fails.** Memory note saved.

Suite went 94 → 301 unit tests (0 failures), MCP went 11 → 17 tools.

## 2025-02-24 — MCP end-to-end validation + ref coercion fix

- Tested all 10 MCP tools on real emulator (emulator-5554, API 35)
- Full workflow: launch → snapshot → tap → type → back → screenshot — all verified
- Drove Messages app end-to-end: compose → type number → type message → send
- Found bug: `resolveRef()` in `interact.js` used `refMap.get(ref)` but MCP passes refs as strings, refMap keys are integers. `Map.get("7") !== Map.get(7)`.
- Fix: coerce `typeof ref === 'string' ? Number(ref) : ref` in `resolveRef()`
- Commit: d4a8bd2

## 2025-02-24 — MCP server (Phase 3)

- Built `mcp-server.js` — raw JSON-RPC 2.0 over stdio, 10 tools, ~200 lines
- Copied scaffold from barebrowse, swapped in baremobile tool defs + handlers
- 10 tools: snapshot, tap, type, press, scroll, swipe, long_press, launch, screenshot, back
- Singleton lazy session — `connect()` on first tool call, auto-detect device
- Screenshot returns MCP `image` content type (base64 PNG)
- Large snapshots saved to `.baremobile/screen-{timestamp}.yml`
- Created `.mcp.json` config file
- 15 unit tests: tool definitions, JSON-RPC dispatch, saveSnapshot logic
- Smoke tested: `initialize` + `tools/list` work via piped JSON-RPC
- 109 tests passing (93 unit + 16 integration)

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
