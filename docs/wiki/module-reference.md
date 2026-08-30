---
type: reference
title: Module Reference
status: stable
contract: docs/product/prd.md
---

# Module Reference

Per-file walkthrough of every module in `src/` plus the two entry points (`mcp-server.js`, `cli.js`). Grouped by pipeline stage: Android transport/parsing, shared prune+format, interaction, platform entry points, Termux support, iOS transport, and process/session glue.

## Android snapshot pipeline

- **`src/adb.js`** -- ADB transport, a thin wrapper around `child_process.execFile('adb', ...)`. Exposes `exec`, `shell`, `listDevices`, `dumpXml`, `screenSize`. Uses `exec-out` for binary-safe output (plain `shell` mangles line endings), dumps to `/data/local/tmp/baremobile.xml`, infers device type from serial format, and allows a 4MB buffer for large UI trees (prd.md:127-140).
- **`src/xml.js`** -- zero-dependency regex-based parser turning uiautomator dump XML into a node tree (`parseXml`, `parseBounds`). Handles both closed and self-closing `<node>` tags, returns `null` on an `ERROR:`-prefixed or empty input, and normalizes attribute names such as `content-desc` -> `contentDesc` (prd.md:142-172).
- **`src/prune.js`** -- 4-step pipeline (`prune(root)` -> `{tree, refMap}`) that assigns refs to interactive elements and shrinks the tree: assign refs to clickable/editable/scrollable nodes, collapse single-child wrapper layouts, drop empty leaves, and deduplicate repeated same-class/same-text siblings (handles RecyclerView repeats). A node is kept if it has a ref, text, contentDesc, or checked/selected/focused state (prd.md:174-192).
- **`src/aria.js`** -- YAML-like formatter (`formatTree`, `shortClass`) that renders the pruned tree, e.g. `- Button [ref=3] "Submit" (submit form) [checked, focused]`. Maps 27 Android and 29 iOS class/type names to short role names (Button, Text, Image, List, Group, etc.), falling back to the last segment of an unknown fully-qualified class name. Renders `checked`, `selected`, `focused`, and `disabled` (inverse of `enabled`) states (prd.md:194-233).

## Interaction primitives

- **`src/interact.js`** -- all interaction goes through `adb shell input`; every function takes `opts` last for `{serial}`. Exposes `tap`/`tapXY`/`tapGrid`/`buildGrid` for coordinate and grid-based tapping, `type` (focus-tap then word-by-word input using KEYCODE_SPACE between words, an API 35+ workaround since `input text` breaks on spaces), `press` (named/numeric key events), `swipe` (all five numeric args coerced via `Math.round(Number())`, throwing `InvalidArgument` on non-finite input as of v0.8.1), `scroll` (swipe within element bounds), and `longPress` (zero-distance swipe held 1000ms) (prd.md:235-260). `type()` also shell-escapes special characters per word and waits 500ms after the focus tap before typing (prd.md:271-274).

## Platform entry points

- **`src/index.js`** -- public Android API. `connect(opts)` (accepts `device` serial/`'auto'`, or `termux: true` for localhost auto-detect) returns a page object; `snapshot(opts)` is a stateless one-shot dump+parse+prune+format. The page object exposes `snapshot`, `tap`, `type`, `press`, `swipe`, `scroll`, `longPress`, `back`, `home`, `launch`, `intent`, `tapXY`, `tapGrid`, `grid`, `screenshot`, `waitForText`, `waitForState`, `close` (no-op, ADB is stateless), and `serial` (prd.md:277-303).
- **`src/ios.js`** -- iOS API using the same page-object pattern as Android, communicating with WDA on-device via `fetch()`. Snapshot pipeline is WDA `/source` -> `translateWda()` -> shared `prune()`/format. Tap/type/scroll are coordinate-based; `back()` looks for a back button in the refMap or falls back to a swipe-from-left; `unlock(passcode)` detects a locked state and enters the passcode (prd.md:305-317). `connect()` auto-discovers WDA in order: cached WiFi IP from a per-user config file (validated, tried over direct HTTP as of v0.8.1), USB discovery via the Node.js usbmuxd proxy (fetches WiFi IP from `/status`, validates and caches it), and finally `localhost:8100` (prd.md:319-322).

## Termux support

- **`src/termux.js`** -- Termux ADB helper: `isTermux()` detects the environment, `findLocalDevices()` parses `adb devices` for `localhost:PORT` entries, `adbPair`/`adbConnect` handle wireless debugging pairing/connection, and `resolveTermuxDevice()` auto-detects the localhost serial for `connect({termux: true})` (prd.md:324-332).
- **`src/termux-api.js`** -- 16 functions wrapping `termux-*` CLI commands, requiring no ADB or screen control: SMS send/list, phone calls, location, camera photo, clipboard get/set, contact list, notifications, battery status, volume get/set, WiFi info, torch toggle, vibrate, and an `isAvailable()` presence check (prd.md:334-354).

## iOS transport and setup

- **`src/usbmux.js`** -- Node.js TCP proxy to `/var/run/usbmuxd`, replacing the pymobiledevice3 port forwarder that had socket cleanup race conditions. Uses binary protocol version 0 for Connect (type=2) and version 1 plist for ListDevices (type=8), handles 10+ concurrent requests with zero crashes, and binds its local proxy to `127.0.0.1` only since the WDA endpoint it forwards to is auth-less (v0.8.1) (prd.md:356-361).
- **`src/ios-cert.js`** -- tracks the WDA signing timestamp written by `baremobile ios resign` and warns when the cert is more than 6 days old (the free Apple ID cert expires after 7 days); the warning is prepended to the first iOS snapshot returned by the MCP server (prd.md:363-365).
- **`src/setup.js`** -- interactive setup wizard for both platforms, detecting existing configuration and guiding through remaining steps. Android offers Emulator, USB, WiFi, and Termux sub-modes, with `ensureAdb()`/`ensureSdk()`/`findSdkRoot()`/`findSdkTool()` helpers. iOS setup checks pymobiledevice3, USB device, developer mode, WDA install, tunnel, and WDA connectivity; the Apple ID password is read via masked `promptSecret` but is still briefly visible in `ps`/`/proc` when passed to AltServer-Linux, an inherent limitation of that CLI (v0.8.1). `restartWda()` provides non-interactive, two-tier WDA recovery -- a fast ~3s tier-1 restart from stored PID-file state, falling back to a full tunnel restart -- called by the MCP server on a second iOS connection failure. The per-user PID file stores tunnel/WDA/forward PIDs and RSD addr/port, with `loadPids()` backward-compatible with the legacy single-line format (prd.md:367-379).

## Process and session glue

- **`src/daemon.js`** -- background process for CLI session mode, holding the device connection and buffering logcat entries. Uses a Unix domain socket for IPC; logcat is captured via a background `adb logcat` spawn, buffered, and flushed to `.baremobile/logcat-*.json`. Session state lives in a `0600` `.baremobile/session.json` carrying the loopback control port and a per-session token; `/command` requires a constant-time token check (since loopback is reachable by any local uid, the token -- not just file permissions -- is what gates control), caps request bodies at 1 MiB, and `/status` remains open as a liveness probe (v0.9.0, superseding the earlier v0.8.1 "file mode is sufficient" approach) (prd.md:381-386).
- **`src/session-client.js`** -- IPC client used by `cli.js` to send commands to a running daemon (prd.md:388).

## Entry points

- **`mcp-server.js`** -- JSON-RPC 2.0 over stdio exposing 17 tools: `snapshot`, `tap`, `type`, `press`, `scroll`, `swipe`, `long_press`, `launch`, `activate` (iOS-only), `screenshot`, `back`, `grant_permission`/`revoke_permission`/`clear_app_data`/`list_permissions` (Android-only), `wait_stable`, `find_by_text`. All tools accept optional `platform` (`android`/`ios`/`auto`) and `serial`, and the server auto-restarts the WDA tunnel via `restartWda()` on a second iOS connection failure. Pages are created lazily per platform on first tool call; action tools return `'ok'` while the agent calls `snapshot` explicitly to observe state; snapshots over 30K characters are saved to `.baremobile/screen-{timestamp}.yml` instead of being returned inline (prd.md:390-399).
- **`cli.js`** -- full CLI command set covering session control (`open`, `close`, `status`), observation (`snapshot`, `screenshot`, `grid`, `logcat`), interaction (`tap`, `tap-xy`, `tap-grid`, `type`, `press`, `scroll`, `swipe`, `long-press`), navigation (`launch`, `intent`, `back`, `home`, `wait-text`, `wait-state`), and platform/server management (`mcp`, `setup`, `ios resign`, `ios teardown`). Supports `--platform=ios` and `--json` for machine-readable output (prd.md:401-407).
