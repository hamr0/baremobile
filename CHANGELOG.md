# Changelog

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
