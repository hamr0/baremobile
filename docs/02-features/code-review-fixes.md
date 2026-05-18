# Code Review Fix Plan — v0.7.13

**Status:** Drafted 2026-05-18, awaiting execution
**Source:** `/code-review` pass on `main` at `eacbf42`, cross-verified against source
**Scope:** Fix every Critical + Important finding, ship high-value enhancements, verify with tests

This is a single phased plan. Each phase is independently shippable (own commit, own test run, own version bump if needed). Phases are ordered by blast-radius — security and correctness first, polish and features after.

---

## Phase 1 — Critical security & correctness (v0.7.13)

Goal: close every finding that could cause silent corruption, resource leaks, or remote command execution. Nothing in this phase changes the public API surface.

| # | Finding | File | Fix |
|---|---|---|---|
| 1.1 | Shell injection in `page.launch(pkg)` and `page.intent(action, extras)` — `adb shell <string>` re-parses, so a malicious `pkg` or extras value executes arbitrary commands | `src/index.js:115-130` | Validate `pkg` against `/^[A-Za-z][\w.]*$/`; quote-escape extras with `'\''` substitution; same gate on `action`. Add `shellQuote()` helper in `src/adb.js`. |
| 1.2 | iOS `connect()` leaks WDA session + usbmuxd tunnel if `/session` POST or screen-size probe throws | `src/ios.js:303-323` | Wrap from line 303 through end of `connect()` in `try { … } catch (e) { cleanup(); throw e; }`. Same pattern around `wdaReady` block. |
| 1.3 | Daemon `close` handler races `res.end()` against `process.exit(0)` — client sometimes gets `ECONNRESET` instead of `{ok:true}` | `src/daemon.js:262-269` | Move `server.close()` + `process.exit(0)` into `res.on('finish', ...)` callback. |
| 1.4 | WDA `fetch()` calls have no timeout — when WDA hangs (common after iOS lock), the entire MCP request hangs forever until the client times out | `src/ios.js:22-44` | Add `AbortSignal.timeout(10_000)` to every `wdaFetch`; throw a typed `WdaTimeout` so the existing retry tier (`mcp-server.js:294-340`) triggers correctly. |

**Verification:**
- Add unit tests for `shellQuote()` and `validatePackage()` covering injection vectors (`;`, `$()`, `'`, backticks, newlines).
- Add unit test for iOS `connect()` cleanup-on-failure (mock fetch to reject on `/session`; assert `cleanup` was called).
- Add daemon integration test that calls `close` then re-reads `session.json` (should be unlinked) and gets `{ok:true}` body intact.
- Add unit test that mocks a hung WDA fetch and confirms `AbortError` fires within 11s.

**Exit criteria:** all existing tests pass, four new tests pass, no public-API regressions.

---

## Phase 2 — Important correctness & robustness (v0.7.13)

Goal: eliminate silent-failure modes and leak-prone code paths.

| # | Finding | File | Fix |
|---|---|---|---|
| 2.1 | `wait-text` / `wait-state` accept `""` or `"abc"` as timeout, silently coerce to 0/NaN, return instant "timeout" | `src/daemon.js:178,186` | Parse + validate in a helper `parseTimeout(v, default)`. Throw on `NaN` or negative. |
| 2.2 | iOS `back()` uses cached `_screenH` from connect time — wrong after rotation | `src/ios.js:453-464` | Lazy-refresh `_screenW/_screenH` from `wdaGet('/session/{sid}/window/size')` inside the swipe-fallback branch (only when needed, not on every back). |
| 2.3 | `logcatEntries` array grows unbounded | `src/daemon.js:76-89` | Ring buffer capped at `LOGCAT_MAX = 50_000` lines. Shift in batches of 1k to avoid O(n²). |
| 2.4 | `~/.config/baremobile/wifi-device.json` loaded without validation — corrupt JSON propagates as confusing ADB errors | `src/wifi-persist.js` | Validate `saved.ip` against `/^[\d.]+$/` (v4) or `/^[\da-f:]+$/i` (v6 simplified); ignore + delete file on mismatch. |
| 2.5 | `find_by_text` returns the literal string `"null"` — ambiguous with a label that literally reads "null" | `src/index.js:167-172`, `mcp-server.js:251-254` | Return structured `{ found: boolean, ref?: string }` JSON from MCP; keep the JS API returning `ref \| null`. |
| 2.6 | MCP retry path reads `args.platform` (default `android`) to decide which `_pages` cache to clear — wrong when the failure was from a tool that resolved iOS via fallback | `mcp-server.js:300-307` | Track the resolved platform inside `handleToolCall` (return as part of error context) and use that when clearing. |
| 2.7 | iOS-only and Android-only tools live in one `TOOLS` list — MCP clients see no platform hint | `mcp-server.js` TOOLS array | Annotate each tool description with `(android only)` / `(ios only)` / `(both)`; add `platform` enum constraint in schema where applicable. |

**Verification:**
- Daemon test: send `wait-text` with `timeout: "abc"` → expect explicit error, not silent return.
- iOS test (mocked WDA): rotate-screen scenario; assert `back()` uses fresh size.
- Daemon test: pump 60k logcat lines → assert array length never exceeds 50k.
- Wifi-persist test: write corrupt JSON to fixture, call `loadSavedDevice()`, assert null + file gone.
- MCP unit test for `find_by_text` payload shape.

---

## Phase 3 — Feature parity & dead-code cleanup (v0.7.13)

Goal: remove rot, surface things that already exist but aren't reachable.

| # | Finding | File | Fix |
|---|---|---|---|
| 3.1 | iOS `page.activate(bundleId)` defined + tested but never exposed via CLI/daemon/MCP | `src/ios.js:502-505` | Add `activate` handler to daemon, `baremobile activate <bundle>` CLI command, and MCP tool. |
| 3.2 | Unreachable col-bounds check in `buildGrid().resolve` (regex already bounds `col` to 0..9) | `src/interact.js:135` | Delete the dead branch; keep a one-line comment explaining why row check remains (rows are variable). |
| 3.3 | Stale `// keeps API compatible with future daemon` comment in `page.close()` — daemon already exists | `src/index.js:174-176` | Remove the comment; keep the no-op. |
| 3.4 | `mcp-server.js` header comment says "11 tools" (12 since v0.7.5; more after Phase 3.1) | `mcp-server.js:1-10` | Drop the hardcoded count; refer to `TOOLS` array length. |
| 3.5 | MEMORY.md claims "186+ unit tests, 13+ source files (v0.7.5)" — actually 94 tests, 15 files | `MEMORY.md` | Refresh after Phase 4 lands (test count will jump). |
| 3.6 | Daemon `session.json` write isn't atomic — parent polls and can read partial JSON | `src/daemon.js:282-289` | Write `session.json.tmp` then `fs.renameSync` (atomic on same filesystem). Drop the try/catch retry in the parent. |
| 3.7 | Logcat capture failures swallowed silently — user has no clue why `logcat` returns empty | `src/daemon.js:91-92` | `console.error('[baremobile] logcat capture disabled: ' + e.message)` once, on first failure. |

**Verification:**
- New unit test asserting `activate` is on `page` object for iOS and exported through daemon command list.
- E2E manual: `baremobile activate com.apple.Preferences` (iOS-attached).
- Run `npm test` — no regressions.

---

## Phase 4 — High-value enhancements (v0.8.0 — minor bump, new API)

Goal: ship the agent-quality wins that came out of the review. Each is independently optional; can ship as one PR or as a string of commits.

| # | Enhancement | Files | Why |
|---|---|---|---|
| 4.1 | **Structured error types** — `ElementNotFound`, `WdaUnavailable`, `DeviceTimeout`, `InvalidArgument` | new `src/errors.js`, replace `throw new Error(...)` callsites | MCP retry policy (`mcp-server.js:294-340`) currently substring-matches `err.message` for `'fetch failed'` and `'UND_ERR'`. Typed errors make it explicit and let library users handle without parsing strings. |
| 4.2 | **Selector-based actions** — `page.tap({text: "Settings"})`, `page.type({text: "Email"}, "...")`, `page.scroll({contentDesc: "List"}, "down")` | `src/index.js`, `src/ios.js`, MCP tool schemas | Eliminates the snapshot → find ref → tap dance for the common case. Internally calls `snapshot()` + `findByText()` + existing primitive. |
| 4.3 | **`waitForStable({pollMs, stableMs})`** — return when two consecutive snapshots match | `src/index.js`, `src/ios.js` | Biggest source of agent flake is acting on a still-animating UI. |
| 4.4 | **Platform auto-detect in MCP** — `platform: 'auto'` (default) probes ADB then usbmuxd, picks whichever is connected | `mcp-server.js` | Removes the "always pass platform" requirement from agent prompts. |
| 4.5 | **Bounded snapshot** — `snapshot({maxDepth, maxNodes})` | `src/prune.js`, `src/index.js`, MCP tool | Lets agents cap context use on cluttered screens (e.g. settings lists). |
| 4.6 | **App helpers** — `grantPermission(pkg, perm)`, `clearAppData(pkg)`, `revokeAllPermissions(pkg)` (Android) | new `src/apps.js`, expose via API + MCP | Currently rolled by hand via `intent`. Cheap, high reuse. |
| 4.7 | **Multi-device** — key `_pages` by `{platform, serial}`; add `serial` arg to MCP tools | `mcp-server.js` | Required for lab/CI use; today MCP can only ever address one device per platform. |
| 4.8 | **`DEBUG_BAREMOBILE=1`** env flag — mirror every ADB / WDA / usbmuxd call + duration to stderr | `src/adb.js`, `src/ios.js`, `src/usbmux.js` | Existing `[baremobile]` prefix is used inconsistently; one consistent gate makes forensics tractable. |

**Verification per item:**
- 4.1: Unit test that `tap('999')` throws `ElementNotFound` whose `name === 'ElementNotFound'`.
- 4.2: Unit test that `tap({text: 'Settings'})` calls snapshot then `findByText` then `tap(ref)`.
- 4.3: Mocked snapshot returning A, A, B, B sequence → assert resolves after second B.
- 4.4: Mock ADB present / WDA absent → assert `platform === 'android'`.
- 4.5: Snapshot fixture with 1000 nodes → assert `maxNodes: 100` returns ≤100.
- 4.6: Spawn-mock test that `grantPermission` issues `pm grant <pkg> <perm>`.
- 4.7: MCP test that two `tap` calls with different `serial` route to different `_pages` entries.
- 4.8: Set env var in test, assert stderr contains `[adb]` lines with timing.

---

## Phase 5 — Documentation + release (v0.7.13 and v0.8.0)

For each shipped phase:

1. **CHANGELOG.md** — one entry per fix/enhancement, grouped under `### Fixed` / `### Added`. Reference the finding number from this doc.
2. **docs/03-logs/bug-log.md** — append entries for findings 1.1–2.7 with root cause + fix.
3. **docs/03-logs/decisions-log.md** — append entries for structural choices (typed errors, selector-based actions, atomic session.json).
4. **docs/03-logs/implementation-log.md** — what landed when.
5. **docs/03-logs/validation-log.md** — test counts before/after, new test files.
6. **MEMORY.md** — refresh test count + file count + tool count once Phase 4 lands.
7. **package.json** — bump `version`. Phase 1–3 → `0.7.13`. Phase 4 → `0.8.0`.
8. Tag the release in git.

---

## Out of scope (deferred)

The following review items were deliberately not included; left as ideas for a future plan:

- Screenshot diff / change-detection mode (`snapshot({since: <hash>})`).
- Embedded screenshot reference inside YAML snapshot.
- Bound check for `tapXY` against screen dimensions.
- iOS `terminate(bundleId)` companion to `launch`/`activate`.
- Configurable grid `cols` parameter (today hardcoded 10).

---

## Execution order (suggested commits)

```
feat: shellQuote + validatePackage; fix launch/intent injection      [1.1]
fix: iOS connect() cleans up WDA session on early failure            [1.2]
fix: daemon close waits for response flush before exit                [1.3]
feat: WDA fetch timeout via AbortSignal                              [1.4]
─── tag v0.7.13-rc1, run full suite ───
fix: validate timeout args in daemon wait-text/wait-state             [2.1]
fix: iOS back() refreshes screen size on demand                       [2.2]
feat: bounded logcat ring buffer                                      [2.3]
fix: validate saved wifi IP on load                                   [2.4]
feat: find_by_text returns structured JSON over MCP                  [2.5]
fix: MCP retry clears the platform that actually failed               [2.6]
feat: MCP tool descriptions annotate platform                         [2.7]
feat: expose iOS activate() in CLI/daemon/MCP                         [3.1]
chore: remove dead grid col check, stale comments, hardcoded counts   [3.2-3.5]
fix: atomic session.json write                                        [3.6]
feat: log logcat capture disable reason                               [3.7]
docs+release: CHANGELOG, bug-log, decisions-log, bump 0.7.13         [Phase 5]
─── tag v0.7.13, publish ───
feat: structured error types                                          [4.1]
feat: selector-based actions                                          [4.2]
feat: waitForStable                                                   [4.3]
feat: MCP platform auto-detect                                        [4.4]
feat: bounded snapshot                                                [4.5]
feat: app helpers (grantPermission, clearAppData)                     [4.6]
feat: multi-device support                                            [4.7]
feat: DEBUG_BAREMOBILE observability                                  [4.8]
docs+release: bump 0.8.0                                              [Phase 5]
─── tag v0.8.0, publish ───
```

---

## Estimated effort

| Phase | Items | Effort (focused work) |
|---|---|---|
| 1 | 4 fixes + 4 tests | 2-3h |
| 2 | 7 fixes + 5 tests | 3-4h |
| 3 | 7 fixes + 2 tests | 2h |
| 4 | 8 features + 8 tests | 6-8h |
| 5 | docs + release | 1h |
| **Total** | **26 fixes + 26 enhancements** | **~14-18h** |
