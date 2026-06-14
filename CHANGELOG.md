# Changelog

## [Unreleased]

### Documentation

- **README — "The bare ecosystem" section recast from a 4-column table to a Core / Optional-reach list.** Now covers all six modules — core `bareagent` · `bareguard` · `litectx`, optional reach `barebrowse` · `baremobile` · `beeperbox` — in a scannable row form that also renders cleanly on npm. README only; no package change.

## 0.9.0 — 2026-05-29

### Added
- **TypeScript declaration files (`.d.ts`) now ship with the package.** Adopters get full autocomplete and type-checking on `baremobile` and `baremobile/ios` without any TypeScript in their project. Types are generated from the existing JSDoc via `tsc` (dev-only `typescript` + `@types/node`), so source and types can never drift. `package.json` `exports` gain a `types` condition on every subpath; `files` now ships `types/` and `CHANGELOG.md`.
- **`ci.yml`** — push/PR workflow gating on `npm ci → typecheck → build:types → test`. No lint step (tsc's `checkJs` + `strictNullChecks` covers the bug class).

### Changed
- **CI:** the publish workflow now polls the npm registry for ~2 min (was ~15s; `--prefer-online` skips npm's view cache) and accepts an `exit 0` publish even if the registry hasn't reflected it yet, so a successful-but-slow-to-reflect publish no longer reports a false failure.
- **`publish.yml` is now manual-only (`workflow_dispatch`) — npm OIDC trusted publishing with provenance, idempotent, and verifies the registry end-state.** Now also typechecks before publishing; `prepublishOnly` builds the `.d.ts` into the tarball.
- JSDoc filled in / tightened across `src/` so `tsc --noEmit` (checkJs + strictNullChecks) passes clean. No runtime behavior changed — the 301-test suite is unchanged and still green.

### Security
- **Daemon `/command` now requires a per-session token (Medium).** `src/daemon.js`: the control endpoint was unauthenticated and only the `0600` `session.json` (carrying the port) gated it. But loopback is reachable by *every* local uid, so another local user who couldn't read `session.json` could still port-scan `127.0.0.1`, find the daemon, and drive the connected device. This reverses the v0.8.1 decision that a token "would add no protection" — that reasoning held only for same-uid access; it missed that the port itself is uid-independent. A `randomBytes(32)` token is now written into the `0600` `session.json` and required (constant-time compare) on `/command`, binding device control to "can read our session file" rather than "can guess a 16-bit port". The client sends it transparently.
- **Predictable `/tmp` files moved to `~/.config/baremobile/` (Low).** `src/ios-cert.js` (`ios-signed`) and `src/setup.js` (`ios-pids`) used fixed, world-writable `/tmp` paths. `loadPids()` feeds `process.kill(SIGKILL)`, so a planted PID file let another local user make us kill arbitrary user-owned processes; the cert stamp could be redirected to suppress expiry warnings. Both now live in the per-user config dir (matching `wifi-persist.js`/`ios.js`, moved in v0.8.1).
- **Android cmdline-tools download/extract no longer uses fixed `/tmp` paths (Low).** `src/setup.js`: the SDK archive was downloaded to and extracted at predictable `/tmp` paths and the extracted `sdkmanager` then executed — a TOCTOU/symlink window for a co-located user to swap binaries. Now uses an owner-only `mkdtemp` work dir with `try/finally` cleanup.
- **Daemon `/command` request body is now capped (Low).** `src/daemon.js`: the handler accumulated the request body unbounded; a local client could stream a large body and OOM the daemon. Bodies over 1 MiB are rejected with `413`.
- **Device UDIDs redacted from a tracked doc (Low).** Two real device UDIDs were committed in `ios/aria-kba-old/wda-ios-automation-poc.md`; replaced with placeholders. (They remain in git history — identifiers, not credentials, so no history rewrite.)

## 0.8.1

Security review of the dual-platform control surface. Every finding was reproduced with an executable PoC (full MCP path) before the fix and re-tested after; the contrast cases confirm `tap`/`tapXY`/`press` were never affected. 301 unit tests still pass.

### Security

- **Command injection via `swipe` coordinates (High)** — `src/interact.js`: `x1..duration` were interpolated raw into `input swipe …`, which re-parses on the device shell. The MCP and daemon transports don't enforce the `number` schema, so a non-numeric value such as `x1: "0 0 0 0 0; reboot;"` reached the device shell and executed — the one device-shell sink that wasn't coerced or quoted (unlike `tap`/`tapXY`/`press`). Now every value goes through `Math.round(Number())` and throws `InvalidArgument` on non-finite input, so only digits and a leading minus can land in the command string.
- **usbmux forwarder bound to all interfaces (Medium)** — `src/usbmux.js`: `server.listen(localPort, …)` omitted the host, so Node bound `0.0.0.0`/`::`, exposing the auth-less WDA endpoint (full iPhone control) to the local network during a USB session. Now binds `127.0.0.1` only, and the in-process consumer connects to `127.0.0.1` explicitly (not `localhost`) so the path never depends on whether `localhost` resolves to IPv4 or IPv6 first.
- **iOS WiFi-IP cache in shared `/tmp`, used unvalidated (Low)** — `src/ios.js`: the device IP was read from a predictable `/tmp/baremobile-ios-wifi` and used verbatim as the WDA host, so another local user could symlink/clobber the file or plant an IP to redirect the agent's WDA traffic. Moved to `~/.config/baremobile/ios-wifi` (per-user, like `wifi-persist.js`) and gated on both read and write by `isValidIpv4()`.
- **Daemon session file world-readable (Low)** — `src/daemon.js`: `session.json` carries the unauthenticated daemon's loopback port and was written `0644`. Now written `0600` so another local user can't read the port (the proportionate fix — a same-uid process can read our files regardless, so a token would add no protection it doesn't already have).
- **Apple ID password echoed at the prompt (Low)** — `cli.js`/`src/setup.js`: the password prompt echoed keystrokes to the terminal and scrollback. Added a masked `promptSecret` (readline `_writeToOutput` mute) used for both password prompts, with an `ui.prompt` fallback for test doubles.

### Known limitation

- AltServer-Linux takes the Apple ID password as a CLI argument (`-p <password>`), so it is briefly visible to other local users via `ps`/`/proc/<pid>/cmdline` while signing runs. This is inherent to the AltServer CLI and cannot be avoided from this package; documented in `src/setup.js`. Run setup on a single-user machine.

## 0.8.0

Code-review fix plan — security, robustness, typed errors, and agent ergonomics. See `docs/02-features/code-review-fixes.md` for the phased plan and `docs/03-logs/{bug-log,decisions-log,implementation-log,validation-log}.md` for full provenance.

### Security (Critical — Phase 1)

- **Shell injection in `page.launch(pkg)`** [1.1]: `pkg` was interpolated directly into `am start … ${pkg}`; an attacker-controlled package name like `com.x; touch /tmp/pwned; #` re-parsed on the device and executed. New `validatePackage()` rejects anything outside `/^[A-Za-z][A-Za-z0-9_.]*$/`.
- **Shell injection in `page.intent(action, extras)`** [1.1]: string extras were wrapped in literal single quotes, so a value containing `'` broke the quoting. New `shellQuote()` uses the `'\''` idiom (POSIX-safe); `validateIntentAction()` and `validateExtraKey()` gate the dotted-identifier surface.
- **Shell injection in Android app helpers (new)** [4.6]: `pm grant`, `pm revoke`, `pm clear`, `dumpsys package` all go through `validatePackage()` + new `validatePermission()` before any string interpolation.

### Fixed (Important — Phase 1 + 2 + 3)

- **iOS `connect()` leaked WDA session + usbmuxd tunnel** [1.2] when `/session` POST or screen-size probe failed. Bring-up is now wrapped in try/cleanup-and-rethrow.
- **Daemon `close` response was raced by `process.exit(0)`** [1.3]: clients saw `ECONNRESET` instead of `{ok: true}`. The exit is now chained through `res.end(..., () => server.close(() => process.exit(0)))`.
- **WDA `fetch()` had no timeout** [1.4]: a hung WDA parked the entire MCP call forever. Each attempt now carries `AbortSignal.timeout(BAREMOBILE_WDA_TIMEOUT_MS ?? 10_000)`. The third failure surfaces as `WdaTimeout` (typed); the MCP retry tier recognises it.
- **`wait-text` / `wait-state` silently coerced malformed timeouts to NaN/0** [2.1]: `timeout: "abc"` meant `Date.now() - start < NaN` was always false, returning instantly. New `parseTimeout()` rejects non-decimal strings, negatives, NaN.
- **iOS `back()` swiped at a stale Y on rotation** [2.2]: cached `_screenH` was used after orientation changes. The fallback path now re-queries `/window/size` on demand.
- **Logcat grew unbounded** [2.3] on long-lived daemons. New `pushBounded()` ring buffer caps at 50k lines with 1k-line amortised trimming. Capture errors now surface to stderr.
- **`wifi-device.json` would propagate a poisoned IP** [2.4]: new `isValidIpv4()` gates loading; corrupt records are deleted.
- **MCP `find_by_text` returned the literal string `"null"`** [2.5] — ambiguous with a label that reads "null". Now returns structured JSON `{found: true, ref: "N"} | {found: false}`.
- **MCP retry tiers used divergent literal `'android'` defaults** [2.6]: drift between call-site and retry could clear the wrong cache slot. New `resolvePlatform()` / `resolvePlatformAsync()` are a single source of truth.
- **Daemon `session.json` write was non-atomic** [3.6]: the parent poll loop could read a partial file. New `atomicWriteFileSync()` writes `<path>.tmp` then `rename(2)`s over the target.

### Added (Phase 3 + Phase 4)

- **iOS `activate(bundleId)` exposure** [3.1]: defined in `src/ios.js` since v0.7.0 but never reachable. Now available as `baremobile activate <bundleId>`, daemon `activate` command, and MCP `activate` tool (gated `_platforms: ['ios']`).
- **Typed error hierarchy** [4.1]: `src/errors.js` exports `BaremobileError` base plus `ElementNotFound`, `SelectorNotFound`, `WdaTimeout`, `WdaUnavailable`, `WaitTimeout`, `InvalidArgument`, `DeviceError`. Each sets `.name` and `.code` and preserves `.cause`. `isConnectionError(err)` is the single discriminator used by both MCP retry tiers — replaces brittle `msg.includes('fetch failed')` chains.
- **`platform: 'auto'`** [4.4]: `resolvePlatformAsync` probes ADB then usbmuxd, caches the result for the process lifetime.
- **`DEBUG_BAREMOBILE=1`** [4.8]: `src/debug.js` exposes `traceCall(channel, label, fn)` — mirrors every ADB / WDA call to stderr with channel, label, outcome, latency. Cheap no-op when disabled.
- **Selector-based actions** [4.2]: `page.tap`, `type`, `scroll`, `longPress` accept either a ref or a selector object `{text|contentDesc}`. MCP tools expose `selector` alongside `ref`; the handler enforces "at least one" with a clear `InvalidArgument` before any device round-trip.
- **`page.waitForStable({pollMs, stableMs, timeout})`** [4.3]: the general "wait out animations" primitive. Exposed as MCP `wait_stable`.
- **Bounded snapshot** [4.5]: `prune(root, {maxDepth, maxNodes})` and `page.snapshot({...})`. Returns a `truncated: bool` flag.
- **Android app helpers** [4.6]: `grantPermission`, `revokePermission`, `clearAppData`, `listPermissions` on the page object. Four corresponding MCP tools (`[android-only]`).
- **Multi-device** [4.7]: `_pages` keyed by `{platform, serial}`. Every MCP tool advertises an optional `serial` arg. Retry tiers clear the keyed slot only.
- **MCP platform annotations** [2.7]: every tool description leads with `[android|ios]` / `[ios-only]` / `[android-only]` and carries a `_platforms` array. `handleToolCall` refuses cross-platform calls up front.

### Changed

- All hot-path generic `throw new Error(...)` in `src/index.js`, `src/ios.js`, `src/interact.js`, `src/apps.js` migrated to typed errors.
- MCP `find_by_text` description updated to advertise the JSON shape.
- MCP server header comment drops the hardcoded "11 tools" enumeration.
- `page.close()` comment cleaned up.
- Unreachable `col < 0 || col >= cols` branch in `buildGrid().resolve` deleted.

### Testing

301 unit tests, 0 failures (was 94 at start of v0.8.0). 9 new test files including stress + necessity proofs that each fix is justified.

## 0.7.11

Bug fixes and robustness improvements.

### Fixed
- **MCP symlink path mismatch**: `realpathSync` fix for `isMain` guard — MCP server failed to start when invoked via symlink (e.g. `npx baremobile mcp`).
- **MCP version hardcoded**: `serverInfo.version` was stuck at `0.7.5`. Now reads from `package.json` at startup.
- **`launch()` fails for some apps**: Apps without a MAIN/LAUNCHER intent (e.g. `com.termux`) failed silently. Now falls back to `monkey` launch.
- **WiFi devices classified as USB**: `listDevices()` only checked for `emulator-` prefix. IP:port serials (e.g. `192.168.1.42:5555`) now correctly reported as `type: 'wifi'`.
- **`type()` mangles shell special chars**: Characters like `~`, `#`, `%`, `^`, `*`, `{`, `}`, `[`, `]`, `!`, `?` were not escaped. Fixed.
- **`setupWifi()` early-exit skipped save**: When a WiFi device was already connected, `saveDevice()` was not called — breaking auto-reconnect after DHCP change.

### Changed
- **Faster subnet scan**: `reconnectWifi()` tries `arp -a` (instant) then `nmap -sn` (fast) before falling back to parallel ping sweep.

## 0.7.10

WiFi auto-reconnect — no more manual setup after DHCP changes.

### New
- **WiFi auto-reconnect**: `connect()` automatically reconnects to saved WiFi devices when no ADB device is found. Saves device IP to `~/.config/baremobile/wifi-device.json` during `baremobile setup` WiFi flow.
- **Subnet scan fallback**: If saved IP fails (DHCP reassigned), scans the local subnet to find the device. Updates saved IP for next time.
- **`src/wifi-persist.js`**: New module — `saveDevice()`, `loadSavedDevice()`, `reconnectWifi()`.

### Changed
- **`connect()` in `src/index.js`**: When `listDevices()` returns empty, tries auto-reconnect from saved WiFi config before throwing.
- **`setupWifi()` in `src/setup.js`**: Saves device IP after successful WiFi connection.

## 0.7.9

Setup wizard detects existing WDA, cleans up stale processes.

### Changed
- **WDA skip-reinstall**: `baremobile setup` → option 2 now checks if WDA is already installed with a valid cert. If so, offers to start the server directly — skips sign/install and manual device settings steps.
- **Process cleanup before start**: `startWda()` kills any previous tunnel, WDA, and port-forward processes (from PID file or by pattern) before spawning new ones. No more orphan accumulation.
- **WDA boot wait increased**: Status polling changed from 3×2s (6s) to 5×3s (15s) — WDA sometimes needs 10-15s on cold boot.
- **Cert check tolerant**: `checkIosCert()` returns null (no warning) when signing record is missing, instead of a misleading "no record found" warning. `/tmp` files don't survive reboot — absence means unknown, not expired.

## 0.7.8

Android setup wizard with 4 connection modes.

### New
- **Android sub-menu**: `baremobile setup` → Android now shows 4 options: Emulator, USB device, WiFi device, Termux.
- **`ensureAdb(ui, host)`**: Detects `adb` in PATH, installs via brew/dnf/apt if missing with user confirmation.
- **`ensureSdk(ui, host)`**: Finds existing Android SDK or installs command-line tools + platform-tools + emulator + Android 35 system image (~3GB). macOS via Homebrew, Linux/WSL via direct download.
- **`findSdkRoot()`**: Checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, common paths (`~/Android/Sdk`, `/usr/lib/android-sdk`), and PATH-based inference.
- **`findSdkTool(sdkRoot, tool)`**: Locates SDK binaries (sdkmanager, avdmanager, emulator) across standard SDK directory layouts.
- **Emulator flow**: Full SDK install → AVD creation (`baremobile` AVD, Pixel 6, Google APIs image) → emulator launch → boot polling (up to 120s) → verification.
- **USB flow**: Improved device detection with specific handling for `unauthorized`, `offline`, and missing states. Minimum version note (Android 10+).
- **WiFi flow**: Detects existing WiFi-connected devices, guides USB-first TCP/IP setup or direct IP connect.
- **Termux flow**: Detects `$TERMUX_VERSION` env var. Inside Termux: guides package install + wireless debugging pair/connect. Outside Termux: explains use case, links to F-Droid, mentions Termux:API.

### Fixed (found during real-device testing)
- **`findSdkTool` matched directories**: `/android-sdk/emulator` (directory) returned instead of `/android-sdk/emulator/emulator` (binary). Now checks `statSync().isFile()`.
- **Missing `ANDROID_HOME` in spawned processes**: avdmanager/emulator couldn't find AVDs or system images. Now threads `sdkEnv` to all SDK commands.
- **AVD name collision**: `includes('baremobile')` false-matched `baremobile-test`. Now uses exact regex.
- **Wrong system image name**: Hardcoded `google_apis` but some SDKs have `google_apis_playstore`. New `findSystemImage()` detects what's installed.
- **Unhandled emulator spawn error**: EACCES crashed Node. Now catches spawn errors gracefully.
- **Stale emulator processes**: Kills old qemu processes before launching fresh emulator.

### Tests
- 186 unit tests (up from 179). New: findSdkRoot env var handling (3), findSdkTool null/fallback/directory-skip (4).

## 0.7.7

WDA-only restart with stored RSD — no pkexec popup.

### Changed
- **`restartWda()` tier-1**: Stores RSD address/port in PID file (second line). On WDA death, restarts just WDA + port forward in ~3 seconds using stored RSD — no pkexec popup, no tunnel restart. Tier-2 (full restart) only triggers if RSD missing or tunnel dead.
- **PID file format**: Extended to 2 lines — `<tunnelPid> <wdaPid> <fwdPid>\n<rsdAddr> <rsdPort>`. `loadPids()` is backward-compatible with legacy 1-line format.
- **`loadPids()` exported**: Now available for testing and external use.

### Tests
- 179 unit tests (up from 176). New: loadPids 2-line format (1), legacy 1-line format (1), missing file (1).

## 0.7.6

iOS custom-UI ref assignment and Retina scale factor API.

### New
- **Accessible element ref assignment**: `translateWda()` now reads the `accessible` attribute from WDA XML. Elements with `accessible="true"`, bounds, and visible text (label or name) are marked clickable — even if their type isn't in `CLICKABLE_TYPES`. Fixes Telegram and other custom-UI apps where chat rows render as `XCUIElementTypeOther` and previously got no refs.
- **`page.scaleFactor`**: Getter returning the device's Retina scale factor (e.g., 3 for iPhone 15). Computed at connect time from screenshot pixel width vs logical window width.
- **`page.screenshotToPoint(px, py)`**: Converts screenshot pixel coordinates to logical points for use with `tapXY()`. Agents using vision models on screenshots can now tap accurately on Retina displays.

### Tests
- 176 unit tests (up from 168). New: accessible group (5), screenshotToPoint math (3), API completeness updated.

## 0.7.5

iOS snapshot cleanup and WDA tunnel auto-restart.

### New
- **Keyboard subtree stripping**: `translateWda()` skips `XCUIElementTypeKeyboard` subtrees entirely — eliminates ~40 key elements when keyboard is open. Agent uses `type()` instead.
- **Unicode noise stripping**: New `cleanText()` removes RTL/LTR marks (`\u200E`, `\u200F`), directional isolates (`\u2068`/`\u2069`), zero-width spaces (`\u200B`), and BOM (`\uFEFF`) from labels. WhatsApp text is now clean.
- **iOS file path stripping**: Removes `/var/mobile/...` and `/private/var/mobile/...` paths from snapshot text. Profile photo paths no longer waste 120 chars per occurrence.
- **Internal name filter**: `shouldKeep()` in prune.js now ignores camelCase class names with 3+ humps or underscores (e.g. `AdditionalDimmingOverlay`, `ChatScreen_WallpaperView`). These collapse as empty wrappers instead of being kept as text.
- **`findByText(text)`**: New page object method on both Android and iOS — looks up refMap for a text/contentDesc substring match, returns ref number. Zero device calls.
- **`find_by_text` MCP tool**: New tool (11 total) — returns ref number for a text match from the last snapshot.
- **WDA tunnel auto-restart**: `restartWda()` exported from setup.js. MCP server auto-restarts WDA tunnel on second iOS connection failure — kills stale processes, starts tunnel/DDI/WDA/forward non-interactively. Falls back to actionable error message if restart fails.

### Changed
- `cleanText()` replaces `decodeEntities()` in ios.js — handles XML entities, Unicode noise, and file paths in one pass.
- MCP server now has 11 tools (was 10).
- `isInternalName()` exported from prune.js for testing.

### Tests
- 168 unit tests (up from 148). New: keyboard stripping (3), Unicode noise (3), file path stripping (3), findByText (1), internal name filter (8), MCP find_by_text (1), API completeness updated.

## 0.7.4

iOS navigation fixes — tap, back, launch, and WDA resilience.

### Fixed
- **iOS tap silently failing**: Switched from `/wda/tap` to W3C Actions API (`/session/{sid}/actions`) for all taps. WDA's `/wda/tap` endpoint silently fails on many elements; W3C touch action sequence works on the same coordinates. Affects `tap()`, `type()` focus tap, `back()` navbar tap, and `tapXY()`.
- **back() hardcoded y-coordinate**: Swipe fallback used `y=400` regardless of device. Now queries screen size at connect time via `/session/{sid}/window/size` and uses `height/2`.
- **launch() silent failure**: WDA returns error JSON (e.g., "device locked") but code ignored it and returned "ok". Now throws with the error message. Same fix applied to `activate()`.
- **WDA dies with no recovery**: MCP server cached dead iOS page forever. Now auto-detects connection errors (ECONNREFUSED, ECONNRESET, fetch failures), clears cache, retries once. On second failure, returns actionable error: "Reconnect USB and run `npx baremobile setup`."

### Changed
- `longPress()` unchanged — still uses `/wda/touchAndHold` (not reported broken).

## 0.7.3

Setup wizard hardening — graceful error handling, AltServer anisette fallback, output filtering.

### Fixed
- **pkexec cancel**: `waitForOutput()` now listens for process `close` event. Cancelled pkexec rejects instantly instead of waiting 20s timeout. Shows "authentication was cancelled" instead of raw error dump.
- **Tunnel output race**: Wait for `RSD Port` in tunnel output instead of `tunnel created` — fixes race where tunnel appeared ready before port was available.
- **usbmuxd not running**: Detect missing usbmuxd service, exit non-zero with actionable message instead of cryptic ENOENT.
- **No USB device**: Prompt user to connect USB instead of failing with raw adb error.
- **AltServer 502**: Anisette server `armconverter.com` returns 502 intermittently. Setup now auto-retries with `ani.sidestore.io` fallback. Configurable via `ALTSERVER_ANISETTE_SERVER` env var.
- **AltServer cached 2FA**: When Apple session is cached (no 2FA needed), AltServer installs directly. Setup now detects "successfully installed" as success, skips 2FA prompt.
- **AltServer wrong password**: Shows "Double-check your Apple ID email and password" instead of generic server error.
- **AltServer noise**: Filters debug output (signing progress floats, byte dumps, anisette headers, file writes). Only shows: Installing, 2FA prompt, Finished, errors.
- **AltServer stale processes**: Kills leftover AltServer processes before each signing attempt.
- **WDA untrusted profile**: Detects "not been explicitly trusted" error, prompts user to trust cert, retries WDA launch without redoing tunnel/DDI/forward.
- **Setup hangs on exit**: `unref()` WDA/tunnel child stdio pipes and usbmux forward server so Node exits cleanly.
- **Setup pkexec paths**: Use full binary paths for `pkexec` commands — partial paths failed on some distros.
- **Integration tests fail without device**: `cli.test.js` now skips with "No ADB device available" (same as `connect.test.js`).

### Changed
- **Setup step reorder**: WDA install (step 6) now happens before device settings (step 7). Developer Mode toggle only appears after a dev app is installed, so checking it first was wrong.
- **Device settings consolidated**: Developer Mode + VPN trust + UI Automation shown as numbered checklist in one step with clear paths to each setting.
- **Step count**: iOS setup reduced from 10 to 9 steps.

## 0.7.2

- **fix**: `findWdaBundle()` ENOBUFS — `pymobiledevice3 apps list` returns ~3.5MB JSON, exceeded default 1MB `maxBuffer`. Increased to 10MB.

## 0.7.1

Unified `baremobile setup` wizard — one command for Android and iOS setup on Linux, macOS, and WSL.

### New modules
- `src/setup.js` — All setup logic (~400 lines). 4-option menu: Android setup, iOS from scratch (10 steps), start WDA server (5 steps), renew cert (4 steps), teardown. Cross-platform: detects OS + package manager, platform-specific install instructions.

### New features
- **Setup wizard overhaul**: `baremobile setup` now handles everything — tunnel, DDI mount, WDA launch, port forward, AltServer signing — no shell scripts needed.
- **Cross-platform**: Supports Linux (pkexec, dnf/apt), macOS (sudo/xcrun, brew), WSL (sudo, apt). Auto-detects `findPython()` instead of hardcoding `python3.12`.
- **WDA health check**: `src/ios.js` `connect()` calls `wdaReady()` before session creation — fails fast with actionable error message.
- **isMain guard fix**: `mcp-server.js` guards against undefined `process.argv[1]`.

### Changed
- `cli.js` — Thin routing only. Setup/resign/teardown delegate to `src/setup.js`. Added `createUi()` for colored terminal output. Removed ~200 lines.
- Device field names fixed: uses `deviceId`/`serial` (actual usbmux fields) instead of `connectionType`/`serialNumber`.

### Removed
- `ios/setup.sh` — Replaced by `startWda()` in `src/setup.js`
- `ios/teardown.sh` — Replaced by `teardown()` in `src/setup.js`

### Tests
- `test/unit/setup.test.js` — 12 tests: `detectHost`, `which`, `parseTunnelOutput`, `parseWdaBundleFromJson`
- Total: 148 unit tests passing

---

## 0.7.0

iOS full integration — dual-platform MCP, CLI `--platform` flag, setup wizard, cert tracking.

### New modules
- `src/ios.js` — Rewritten WDA-based iOS control. Translation layer (`translateWda()`) converts WDA XML → Android node shape → shared `prune()` + `formatTree()` pipeline. Auto-discovery: cached WiFi > USB (usbmux) > localhost. Coordinate-based tap/scroll/longPress from bounds.
- `src/usbmux.js` — Node.js usbmuxd client (~130 lines, zero deps). Binary protocol to `/var/run/usbmuxd`. Replaces pymobiledevice3 port forwarder (was crashing with socket cleanup race).
- `src/ios-cert.js` — WDA cert expiry tracking. `checkIosCert()` warns when 7-day free Apple ID cert is stale. `recordIosSigning()` records timestamp.
- `ios/setup.sh` — Start iOS bridge: tunnel + DDI mount + WDA launch
- `ios/teardown.sh` — Stop all iOS bridge processes

### New features
- **Dual-platform MCP**: `mcp-server.js` holds per-platform page slots, lazy-created. Every tool accepts `platform: "ios"` (default: android). Both platforms in same session.
- **CLI `--platform=ios`**: `baremobile open --platform=ios` starts iOS daemon. Platform stored in session.json. Android-only commands (`logcat`, `intent`, `tap-grid`, `grid`) return error on iOS.
- **Setup wizard**: `baremobile setup` — interactive, auto-detects what's done, guides through remaining steps for Android or iOS.
- **Cert resign**: `baremobile ios resign` — interactive AltServer signing with Apple ID + password + 2FA prompts. Records timestamp for expiry tracking.
- **iOS teardown**: `baremobile ios teardown` — kills tunnel/WDA processes.
- **Cert warning**: MCP prepends warning to first iOS snapshot if cert is >6 days old or missing.

### Changed
- `src/daemon.js` — Dynamic import based on platform, logcat skipped for iOS, Android-only handler guards, platform in session.json
- `cli.js` — `--platform` flag, setup/resign/teardown commands, updated usage text
- `mcp-server.js` — Removed static import, per-platform page cache, platform param on all tools, neutralized descriptions
- `src/aria.js` — 29 iOS CLASS_MAP entries (Button, Text, Cell, Switch, Key, Icon, etc.)
- `src/prune.js` — iOS-compatible pruning (editable detection, bounds handling)

### Removed
- BLE HID era scripts and tests (moved to `ios/aria-kba-old/` for reference)
- `scripts/ios-ax.py`, `scripts/ios-live-test.js`, `scripts/ios-tunnel.sh`
- `test/ios/` — replaced by `test/unit/ios.test.js` + `ios/test-wda.js`

### Tests
- 136 unit tests (up from 129), 26 integration tests, 9 test files
- New: `test/unit/ios.test.js` — 24 tests (translateWda shape, pipeline integration, CLASS_MAP, coordinates)
- New: `test/unit/usbmux.test.js` — 4 tests (plist parsing, packet construction, forward lifecycle, header format)

### Docs
- All 7 doc files updated for Phase 3.3
- `baremobile.context.md`: MCP tools table with `platform?`, setup/resign commands
- `docs/customer-guide.md`: iOS prerequisites, resign flow, CLI/MCP iOS usage
- `docs/01-product/prd.md`: Phase 3.3 added, MCP section updated for dual-platform
- `docs/04-process/testing.md`: iOS MCP verification steps
- iOS = QA only stated clearly everywhere (USB required on Linux)

## 0.6.0

CLI session mode — 22 commands, logcat capture, `--json` flag for agent consumption.

### New modules
- `src/daemon.js` — Background HTTP server holding a `connect()` session, logcat capture via `adb logcat` child process
- `src/session-client.js` — HTTP client to daemon (sendCommand, readSession, isAlive)

### New features
- `cli.js` — Full CLI with 22 commands: `open`, `close`, `status`, `snapshot`, `screenshot`, `grid`, `tap`, `tap-xy`, `tap-grid`, `type`, `press`, `scroll`, `swipe`, `long-press`, `launch`, `intent`, `back`, `home`, `wait-text`, `wait-state`, `logcat`, `mcp`
- Logcat capture: daemon spawns `adb logcat` in background, buffers entries, flushes to `.baremobile/logcat-*.json` on demand. Supports `--filter=TAG` and `--clear`.
- `--json` flag: any command outputs a single JSON line (`{"ok":true,...}` or `{"ok":false,"error":"..."}`). Agents parse one line per invocation — no text formatting to strip.
- `"bin": {"baremobile": "cli.js"}` in package.json — `npx baremobile` works

### Tests
- 129 tests (103 unit + 26 integration), up from 109
- New: `test/integration/cli.test.js` (10) — open, status, snapshot, launch+snapshot, tap, back, screenshot, logcat, close, status-after-close

### Docs
- prd.md: Phase 4 marked DONE with command reference and `--json` flag
- baremobile.context.md: CLI Session Mode section with commands, output conventions, JSON mode, agent usage
- customer-guide.md: CLI session guide with full command reference table, JSON mode for agents
- testing.md: updated counts (119→129), added CLI test suite section
- README.md: CLI added as first usage option ("Four ways to use it")

## 0.5.1

### Bug fixes
- `interact.js`: fixed ref type coercion in `resolveRef()` — MCP passes refs as strings but refMap keys are integers. Added `Number()` coercion.

### Validation
- Tested all 10 MCP tools end-to-end on real emulator (API 35)
- Full workflow verified: launch Settings, tap, type search, scroll, back, screenshot
- Drove Messages app: compose → type number → type message → send

## 0.5.0

MCP server — 10 screen-control tools over JSON-RPC 2.0 stdio.

### New modules
- `mcp-server.js` — MCP server for Claude Code and other MCP clients
  - Raw JSON-RPC 2.0 over stdio, no SDK dependency
  - 10 tools: snapshot, tap, type, press, scroll, swipe, long_press, launch, screenshot, back
  - Singleton lazy session — `connect()` on first tool call, auto-detect ADB device
  - Action tools return `'ok'`, agent calls snapshot to observe
  - Screenshot returns MCP `image` content type (base64 PNG)
  - Large snapshots (>30K chars) saved to `.baremobile/screen-{timestamp}.yml`
- `.mcp.json` — MCP config file for auto-detection

### Tests
- 109 tests (93 unit + 16 integration), up from 94
- New: `test/unit/mcp.test.js` (15) — tool definitions, JSON-RPC dispatch, saveSnapshot logic

### Docs
- system-state.md: Phase 3 MCP → DONE, updated module count (9) and test count (109)
- prd.md: expanded Phase 3 roadmap with full tool list, session model, config
- baremobile.context.md: added MCP Server Integration section
- testing.md: added MCP test suite section, updated test pyramid counts

## 0.4.0

Termux support — on-device control via localhost ADB + direct Android API access via Termux:API.

### New modules
- `src/termux.js` — Termux environment detection + localhost ADB setup helpers
  - `isTermux()` — detect Termux via `TERMUX_VERSION` env or `/data/data/com.termux`
  - `findLocalDevices()` — scan `adb devices` for `localhost:*` entries
  - `adbPair(port, code)` / `adbConnect(port)` — wireless debugging setup
  - `resolveTermuxDevice()` — find localhost device or throw with setup instructions
- `src/termux-api.js` — 16 Termux:API wrappers (no ADB required)
  - SMS: `smsSend(number, text)`, `smsList(opts)`
  - Telephony: `call(number)`
  - Location: `location(opts)` (GPS/network/passive)
  - Camera: `cameraPhoto(file, opts)`
  - Clipboard: `clipboardGet()`, `clipboardSet(text)`
  - Contacts: `contactList()`
  - Notifications: `notify(title, content, opts)`
  - System: `batteryStatus()`, `volumeGet()`, `volumeSet(stream, value)`, `wifiInfo()`, `torch(on)`, `vibrate(opts)`
  - Detection: `isAvailable()`

### Changed
- `connect()` accepts `{termux: true}` option — resolves localhost ADB device
- `connect()` auto-detects Termux environment when no device specified

### Tests
- 83 tests (71 unit + 12 integration), up from 51
- New: `test/unit/termux.test.js` (14) — detection, parsing, commands, error messages
- New: `test/unit/termux-api.test.js` (18) — exports validation, availability detection, ENOENT errors

### Verified
- Termux ADB POC on emulator: `adb tcpip` → `adb forward` → `adb connect localhost:PORT` → full snapshot + tap + launch through localhost ADB
- Termux:API POC on emulator: sideloaded Termux + Termux:API from F-Droid, validated batteryStatus (JSON), clipboardGet/Set, volume (6 streams), wifiInfo (JSON), vibrate
- SMS/call/location/camera not tested on emulator (no SIM, no GPS hardware) — needs real device

### Docs
- Blueprint: restructured roadmap (dev order: core → termux → termux adb → MCP → CLI → bareagent → multis)
- Blueprint: three levels of phone control (Termux:API / ADB from host / ADB from Termux)
- Context.md: Termux setup, Termux:API usage patterns
- Testing guide: updated counts, new test file descriptions

## 0.3.0

Waiting, intents, platform docs, multis integration path.

### New features
- `page.waitForText(text, timeout)` — poll snapshot until text appears or timeout
- `page.waitForState(ref, state, timeout)` — poll for element state (enabled/disabled/checked/unchecked/focused/selected)
- `page.intent(action, extras?)` — deep navigation via Android intents (`am start -a`), supports string/int/boolean extras

### Docs
- Blueprint: connectivity modes (USB, WiFi, Tailscale), multis integration path, iOS WDA accessibility chain analysis
- context.md: waiting patterns, common intents, vision fallback, switch/toggle quirks, transitional states

### Tests
- 51 tests (39 unit + 12 integration), up from 48
- New: intent deep navigation, waitForText resolve + timeout

## 0.2.0

Screenshot-based vision fallback, coordinate tapping, grid system, entity decoding fix.

### New features
- `page.tapXY(x, y)` — tap by raw pixel coordinates, no ref needed
- `page.tapGrid(cell)` — tap by grid cell label (e.g. `"C5"`)
- `page.grid()` — get labeled grid: 10 cols (A-J), auto-sized rows, with `resolve(cell)` and `text` summary
- `screenSize()` in adb.js — get device screen dimensions via `wm size`

### Bug fixes
- XML entity decoding: `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` now decoded at parse time. Snapshots show `Network & internet` instead of `Network &amp; internet`.

### Tests
- 48 tests (39 unit + 9 integration), up from 36
- New: `test/unit/interact.test.js` (7) — buildGrid cell resolution, bounds, errors
- New: xml entity decoding tests (2)
- New: integration tests for grid, tapXY, tapGrid (3)

### Docs
- README: added device setup guide (USB debugging, WiFi, emulator)
- Blueprint: added future features (waitForText, intent shortcuts, vision fallback)
- Blueprint: added "Why not iPhone" section — WDA friction analysis, Android-only decision
- Blueprint: added Android device setup prerequisites

### Verified flows
- Bluetooth toggle: Settings → Connected devices → Connection preferences → Bluetooth → toggle off → toggle on (transitional `[disabled]` state observed and documented)
- Coordinate tap: `tapXY(540, 1200)` lands correctly on home screen
- Grid tap: `tapGrid('E10')` resolves and lands correctly

## 0.1.0

Core library — 6 modules, ~500 lines, zero dependencies, 36 tests.

### Modules
- `src/adb.js` — ADB transport: exec, shell, listDevices, dumpXml
- `src/xml.js` — Zero-dep regex XML parser for uiautomator output
- `src/prune.js` — 4-step pruning pipeline (assign refs, collapse wrappers, drop empties, dedup)
- `src/aria.js` — YAML formatter with 27 Android class-to-role mappings
- `src/interact.js` — tap, type, press, swipe, scroll, long-press via ADB input
- `src/index.js` — `connect(opts) → page` and `snapshot(opts)` public API

### API
- `connect({device})` — auto-detect or specify device serial
- `page.snapshot()` — uiautomator dump → parse → prune → YAML with `[ref=N]` markers
- `page.tap(ref)`, `page.type(ref, text)`, `page.press(key)`
- `page.swipe()`, `page.scroll(ref, direction)`, `page.longPress(ref)`
- `page.back()`, `page.home()`, `page.launch(pkg)`, `page.screenshot()`

### Tests
- 30 unit tests (xml, prune, aria)
- 6 integration tests (connect, snapshot, launch, back, screenshot, home)
- Integration tests auto-skip when no ADB device available

### Docs
- `docs/blueprint.md` — full architecture, module details, roadmap
- `docs/research.md` — platform feasibility research
- `docs/poc-plan.md` — POC validation criteria (completed, POC deleted)
