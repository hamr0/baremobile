# Changelog

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
