# POC Plan — baremobile

## Goal
Validate that ADB + uiautomator dump + input injection works reliably enough to build an agent-facing library. Single file (`poc.js`), ~200 lines, deleted after validation.

## What We're Validating

1. **Tree extraction:** `uiautomator dump` → XML → parsed tree with all useful attributes
2. **Ref assignment:** Interactive nodes get `[ref=N]` markers, same pattern as barebrowse
3. **Pruning basics:** Collapse empty wrappers, drop invisible/disabled nodes, keep it token-efficient
4. **YAML output:** Same format as barebrowse snapshots — agents already know how to read it
5. **Tap by ref:** Resolve ref → bounds center → `adb shell input tap X Y`
6. **Type by ref:** Focus via tap → `adb shell input text "..."` with proper escaping
7. **Latency:** How long does dump → parse → format take? Is 1-3s acceptable?

## POC Scope

### In Scope
- `adb shell uiautomator dump /dev/tty` — get XML string
- Simple XML parser (no deps — regex or basic state machine, ~50 lines)
- Tree → flat node list with bounds, text, class, content-desc, resource-id, states
- Ref assignment to clickable/editable/scrollable nodes
- Minimal pruning: collapse single-child wrappers with no text, drop invisible
- YAML-like output with `[ref=N]` markers
- `tap(ref)` — bounds center calculation → `adb shell input tap`
- `type(ref, text)` — tap to focus → `adb shell input text` with shell escaping
- CLI: `node poc.js snapshot`, `node poc.js tap 5`, `node poc.js type 3 "hello"`

### Out of Scope (for POC)
- WebView CDP attach
- Swipe/scroll gestures
- Screenshot capture
- Multi-device support
- Error recovery
- Tests (this IS the test)

## Validation Criteria

| Check | Pass | Fail |
|---|---|---|
| XML dump succeeds | Get valid XML from emulator | ADB errors or empty output |
| Parse produces tree | Nodes have bounds, text, class | Parse errors or missing attrs |
| Refs assigned correctly | Interactive elements get refs | Wrong elements or missed ones |
| YAML readable | Agent-friendly, <4K tokens for typical screen | Bloated or unstructured |
| Tap works | Tapping ref triggers correct UI element | Wrong target or no response |
| Type works | Text appears in focused field | Missing chars or wrong field |
| Latency acceptable | <3s for full snapshot cycle | >5s makes it unusable |

## After POC
- POC passes → design proper module structure → build with tests
- POC fails → identify which part fails, research alternatives
- Delete `poc.js` either way — never ship the POC
