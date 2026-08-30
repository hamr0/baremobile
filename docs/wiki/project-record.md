---
type: reference
title: Design Decisions, Roadmap, and Comparisons
status: stable
contract: docs/product/prd.md
---

# Project Record

This page collects baremobile's key design decisions, its phase-by-phase roadmap, how it stacks up against alternative tools, and its external references.

## Design decisions

baremobile's choices consistently favor removing moving parts over adding capability:

- **ADB direct, not Appium** -- avoids a Java server, driver installs, and ~500MB of dependencies; ADB is already present on a dev machine (prd.md:640).
- **uiautomator, not AccessibilityService** -- works without modifying the target app, so no helper APK is needed (prd.md:641).
- **Zero dependencies** -- follows the same philosophy as sister project barebrowse; `child_process.execFile` is sufficient (prd.md:642).
- **YAML-like output, not JSON** -- token-efficient for LLM agents, and agents already know the format from barebrowse (prd.md:643).
- **Refs reset per snapshot** -- stable refs would require diffing/tracking machinery for minimal benefit (prd.md:644).
- **Word-by-word typing** -- required because API 35+ broke `input text` when text contains spaces; this is the only reliable workaround (prd.md:645).
- **dump-to-file + cat** -- `uiautomator dump /dev/tty` is broken on API 35+, so dumping to a file and reading it back is used instead (prd.md:646).
- **`exec-out`, not `shell`** -- `adb shell` mangles `\r\n`; `exec-out` returns raw, binary-safe stdout (prd.md:647).
- **Page object pattern** -- mirrors barebrowse's API shape so agents only need to learn one pattern (prd.md:648).
- **WDA over BLE HID for iOS** -- WDA provides a real element tree and native click, needs no Bluetooth adapter or runtime Python; the earlier BLE HID approach suffered a flat tree, an unreliable mouse, and screenshot blackout (prd.md:649).
- **Node.js usbmux over the pymobiledevice3 forwarder** -- the pymobiledevice3 forwarder crashed due to a socket cleanup race; the Node.js proxy replacement runs with zero crashes (prd.md:650).
- **JSDoc -> `.d.ts`, generated not committed** -- ships TypeScript types (adopter autocomplete and type errors) without a build step or a hand-maintained `.d.ts` file. `tsc`, using dev-only `typescript`/`@types/node`, checks the JSDoc on every push and before publish so types can't drift from source, while production dependencies stay at zero; see `LIBRARY_CONVENTIONS.md` §2 (prd.md:651).

## Roadmap

### Completed phases

Early phases established the core library and its platform reach: 1.0 built the core (connect, snapshot, tap/type/press/swipe/scroll -- 6 modules, 36 tests); 1.5 added a vision fallback (tapXY, tapGrid, buildGrid, screenSize, XML entity decoding); 1.6 added waiting and intents (waitForText, waitForState, page.intent()); 2.0 brought on-device control via Termux ADB; and 2.5 added Termux:API support for SMS, calls, location, camera, and clipboard (16 functions) (prd.md:664-669).

iOS support went through several superseded attempts before settling on WDA: 2.7 was a pymobiledevice3 spike proving Linux-to-iPhone control over USB; 2.8 was a BLE HID spike proving keyboard/mouse input; 2.9-2.95 built a full BLE HID + pymobiledevice3 module -- both 2.8 and 2.9-2.95 were superseded by the WDA rewrite in Phase 3.0 (prd.md:670-672).

From 3.0 onward, iOS was rebuilt on WDA and integrated with the shared pipeline: 3.0 replaced BLE HID with WDA over HTTP (zero Python at runtime); 3.1 added the iOS translation layer (translateWda() plus the shared prune/format pipeline); 3.2 replaced the pymobiledevice3 forwarder with usbmux.js and auto-connect; 3.3 delivered dual-platform CLI/MCP integration, a setup wizard, and cert tracking; 3.4 fixed iOS navigation (W3C Actions tap, screen-size-aware back(), launch error checking); 3.5 added snapshot cleanup and auto-restart (keyboard/Unicode/path stripping, internal name filtering, findByText, and tiered WDA auto-restart -- tier-1 using a stored RSD in ~3s with no pkexec, tier-2 a full tunnel restart); and 3.6 added custom-UI refs and scale-factor handling (an `accessible` attribute for Telegram-style apps, Retina `scaleFactor`, and `screenshotToPoint()`) (prd.md:673-679).

Cross-cutting phases rounded out the tooling: Phase 3 shipped the MCP server (17 tools over JSON-RPC 2.0 via stdio); Phase 4 added CLI session mode (daemon, logcat, full command set); Phase 4.5 brought library-conventions compliance via the JSDoc-to-`.d.ts` types toolchain (checkJs + strictNullChecks, generated on publish and git-ignored, `exports` types conditions on every subpath, and a push/PR `ci.yml` gate) with no runtime change and 301 tests green; and Phase 4.6 (v0.9.0) was a follow-up security hardening pass -- a daemon `/command` token gate with a 1 MiB body cap via a `createCommandServer` factory, predictable `/tmp` files moved to `~/.config/baremobile/`, `mkdtemp`-based cmdline-tools extraction, and UDID redaction -- taking the suite from 301 to 321 tests green (prd.md:680-683).

### Future phases

Four phases remain planned: **Phase 5 (bareagent adapter)** exposes `createMobileTools(opts)` returning `{tools, close}` for the [bareagent](https://www.npmjs.com/package/bare-agent) library, auto-detecting the environment (host ADB, Termux ADB, Termux:API), with roughly 15 UI tools and 10 API tools, where action tools auto-return a snapshot after a 300ms settle. **Phase 6 (WebView CDP bridge)** attaches via CDP to debug-enabled WebViews, combining uiautomator for native parts with the barebrowse ARIA pipeline for WebView parts into a unified snapshot. **Phase 7 (advanced interactions)** adds `pinch(ref, scale)` via `sendevent` multi-touch, `drag(fromRef, toRef)`, `clipboard(text)` via `am broadcast`, and notification shade interaction. **Phase 8 (multi-device)** adds parallel sessions and device farm support (USB hub or cloud emulators) (prd.md:685-691).

## Comparison with alternatives

Against DroidRun, Appium, and agent-device, baremobile's differentiator is a minimal, zero-dependency, ADB-plus-uiautomator approach producing agent-ready output:

| | baremobile | DroidRun | Appium | agent-device |
|---|---|---|---|---|
| Approach | ADB + uiautomator direct | A11y tree + ADB | WebDriver + UiAutomator2 | A11y tree |
| Dependencies | 0 | Python + many | Java server + heavy client | TypeScript + deps |
| Setup | `npm install` + ADB | pip install + configs | Appium server + driver | npm install + build |
| Snapshot format | Pruned YAML with refs | Structured tree | PageSource XML | Structured tree |
| Agent-ready | Yes -- same format as barebrowse | Yes | No -- raw XML | Yes |
| Lines of code | ~1,400 | ~5,000+ | Massive | Growing |
| Philosophy | Minimal, zero deps, vanilla JS | AI-native, funded startup | Enterprise test framework | Multi-platform |

(prd.md:697-704)

Appium is the only one of the three alternatives that does not produce agent-ready output, instead exposing raw XML PageSource, while baremobile, DroidRun, and agent-device all target agent consumption directly (prd.md:702).

## References

- [barebrowse](https://github.com/hamr0/barebrowse) -- sister project for web browsing (prd.md:709)
- [Android uiautomator](https://developer.android.com/training/testing/other-components/ui-automator) (prd.md:710)
- [ADB documentation](https://developer.android.com/tools/adb) (prd.md:711)
- [DroidRun](https://github.com/droidrun/droidrun) -- Python-based Android agent framework (prd.md:712)
- [agent-device](https://github.com/callstackincubator/agent-device) -- TypeScript multi-platform (prd.md:713)
- [bareagent](https://www.npmjs.com/package/bare-agent) -- LLM agent loop library (prd.md:714)
- [WebDriverAgent](https://github.com/appium/WebDriverAgent) -- WDA for iOS automation (prd.md:715)
