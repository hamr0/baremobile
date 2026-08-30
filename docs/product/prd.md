---
type: contract
title: Architecture Blueprint
status: authoritative
---

# Architecture Blueprint

baremobile gives AI agents control of Android and iOS devices, written in vanilla JS as ES modules with zero dependencies (prd.md:3). Android is driven directly through ADB via `child_process.execFile`; iOS is driven through WebDriverAgent (WDA) over HTTP via `fetch()` (prd.md:3). The library follows the same interaction pattern as its sibling project barebrowse: take a snapshot, get back a pruned accessibility tree annotated with `[ref=N]` markers, then tap/type/swipe by ref (prd.md:3).

## Source layout

The codebase is 18 files in `src/` plus 2 top-level entry points, with zero runtime dependencies (prd.md:31). Notable modules:

- `adb.js` — ADB transport: exec, device discovery, XML dump, shell-quoting and validators (prd.md:11)
- `xml.js` — a zero-dependency, pure XML parser with no I/O (prd.md:26)
- `prune.js` — the pruning pipeline plus ref assignment and `maxDepth`/`maxNodes` bounds (prd.md:19)
- `aria.js` — formats the pruned tree as YAML with `[ref=N]` markers (prd.md:12)
- `index.js` — the public Android API: `connect(opts)` returns a page object with selector actions, `waitForStable`, and bounded snapshots (prd.md:16)
- `ios.js` — the iOS equivalent: `connect(opts)` returns a page object backed by WDA over HTTP, with fetch timeout, selector actions, and `waitForStable` (prd.md:18)
- `errors.js` — typed errors (`ElementNotFound`, `SelectorNotFound`, `WdaTimeout`, `WdaUnavailable`, `WaitTimeout`, `InvalidArgument`, `DeviceError`) plus `isConnectionError` (prd.md:15)
- `apps.js` — Android app helpers: `grantPermission`, `revokePermission`, `clearAppData`, `listPermissions` (prd.md:10)
- `usbmux.js` — a Node.js usbmuxd client for iOS USB connections (prd.md:24)
- `ios-cert.js` — tracks WDA certificate expiry, relevant since free Apple ID certs last 7 days (prd.md:17)

At the top level, `mcp-server.js` exposes an MCP server (JSON-RPC 2.0 over stdio) with 17 tools covering both platforms, an `'auto'` platform mode, and multi-device support keyed by serial (prd.md:28), and `cli.js` is the `baremobile <command> [options]` entry point (prd.md:29).

## The shared snapshot pipeline

Both platforms converge on one pipeline after their platform-specific capture step (prd.md:44-52):

- **Android:** `adb exec-out uiautomator dump` produces an XML string (`adb.js`), then `parseXml(xml)` turns it into a node tree (`xml.js`) (prd.md:46-47).
- **iOS:** `fetch('/source')` produces an XML string, then `translateWda(xml)` turns it into a node tree, both in `ios.js` (prd.md:49-50).
- **Shared:** `prune(root)` (in `prune.js`) reduces the tree to a pruned tree plus a ref map, and `formatTree(tree)` (in `aria.js`) renders it as the final YAML string (prd.md:52-53).

Interactions follow the same fork-then-converge shape: on Android, a ref resolves to a bounds center, then `adb shell input tap X Y` (in `interact.js`); on iOS, a ref resolves to a bounds center, then a W3C pointer action (in `ios.js`) (prd.md:57-59).

## The page object

Both platforms expose the same API shape through a `connect()`-returned page object (prd.md:96): `page.snapshot()` for the full YAML tree, or `page.snapshot({ maxNodes: 200 })` for a bounded one (prd.md:63-64). Actions can target either a numeric ref (`page.tap(3)`) or a selector object such as `{ text: 'Settings' }` or `{ contentDesc: 'Email' }`, with `type()` and `scroll()` following the same selector pattern (prd.md:66-71). Other page methods include `press('back')`, `launch(pkg)` (gated by `validatePackage`), and wait helpers `waitForText`, `waitForState`, and `waitForStable({ pollMs, stableMs })` (prd.md:73-78). Android-only app helpers — `grantPermission`, `clearAppData`, `listPermissions` — round out the page object (prd.md:80-84). Consumers import `src/index.js` for Android or `src/ios.js` for iOS to get this same-shaped API (prd.md:87).

## Typed error handling

Hot-path failures throw typed errors instead of opaque strings, so callers can branch on error identity: `ElementNotFound`, `SelectorNotFound`, `WdaTimeout`, `WaitTimeout`, `InvalidArgument`, `DeviceError`, and the `isConnectionError` helper are all exported from `src/errors.js` (prd.md:91-92). The intended pattern is to catch a failed action, check `instanceof SelectorNotFound` to decide whether to re-snapshot and retry, check `isConnectionError(e)` to decide whether to reconnect, and re-throw anything else (prd.md:95-101).

## MCP: auto platform and multi-device

Every MCP tool accepts an optional `serial` parameter, and sessions are cached per `{platform, serial}` pair, which lets one MCP server drive multiple devices concurrently (prd.md:106-107). A tool call can pin to a specific device by passing a `serial` (e.g. `emulator-5554`), or it can pass `platform: 'auto'` and let baremobile probe whichever stack — ADB or WDA — is actually connected (prd.md:110-115).
