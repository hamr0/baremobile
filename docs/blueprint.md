# baremobile — Blueprint

> Vanilla JS library — ADB-direct Android control for autonomous agents.
> Accessibility tree in, pruned snapshot out.

---

## What this is

baremobile gives AI agents control of Android devices. Take a snapshot of the screen, get a pruned accessibility tree with `[ref=N]` markers, tap/type/swipe by ref. Same pattern as [barebrowse](https://github.com/hamr0/barebrowse) — but for native Android apps instead of web pages.

No Appium. No bundled runtime. Zero dependencies. Uses `adb` directly via `child_process.execFile`.

## Architecture

```
src/
├── adb.js        — ADB transport: exec, device discovery, XML dump
├── xml.js        — Zero-dep XML parser (pure, no I/O)
├── prune.js      — Pruning pipeline + ref assignment
├── aria.js       — Format tree as YAML with [ref=N] markers
├── interact.js   — tap, type, press, swipe, scroll, long-press
└── index.js      — Public API: connect(opts) → page object

test/
├── unit/
│   ├── xml.test.js     — XML parsing (10 tests)
│   ├── prune.test.js   — Pruning + ref assignment (10 tests)
│   └── aria.test.js    — YAML formatting + class mapping (10 tests)
└── integration/
    └── connect.test.js — End-to-end against emulator (6 tests)
```

6 modules, ~500 lines, 36 tests (30 unit + 6 integration).

## How it works

```
connect(opts) → page object
  └─ listDevices() → resolve serial

page.snapshot()
  └─ adb exec-out uiautomator dump    → XML string        (adb.js)
  └─ parseXml(xml)                     → node tree         (xml.js)
  └─ prune(root)                       → pruned tree + refMap  (prune.js)
  └─ formatTree(tree)                  → YAML string       (aria.js)

page.tap(ref) / type(ref, text) / press(key) / ...
  └─ resolve ref → bounds center       → adb shell input   (interact.js)
```

## Module Details

### `src/adb.js` — ADB Transport

Thin wrapper around `child_process.execFile('adb', ...)`.

| Export | Description |
|--------|-------------|
| `exec(args, opts)` | Raw adb command. Threads `-s serial` if set. Supports `encoding: 'buffer'` for binary output. |
| `shell(cmd, opts)` | Shortcut for `exec(['shell', cmd])` |
| `listDevices()` | Parse `adb devices -l`, return `[{serial, state, type}]`. Filters to `state === 'device'`. |
| `dumpXml(opts)` | `exec-out` with dump-to-file + cat pattern. 15s timeout. Returns XML string. |

Key details:
- `exec-out` for binary-safe stdout (not `shell` which mangles line endings)
- Dump path: `/data/local/tmp/baremobile.xml`
- `listDevices` infers type from serial prefix (`emulator-` → emulator, else usb)
- 4MB maxBuffer for large UI trees

### `src/xml.js` — XML Parser

Zero-dependency regex-based parser for uiautomator dump XML.

| Export | Description |
|--------|-------------|
| `parseXml(xml)` | XML string → node tree. Returns `null` on empty/error input. |
| `parseBounds(str)` | `"[0,0][1080,1920]"` → `{x1, y1, x2, y2}` or `null` |

Node shape:
```js
{
  class,        // "android.widget.TextView"
  text,         // visible text
  contentDesc,  // content-description (accessibility label)
  resourceId,   // "com.app:id/button"
  bounds,       // {x1, y1, x2, y2} or null
  clickable,    // boolean
  scrollable,   // boolean
  editable,     // boolean (inferred from class containing "EditText")
  enabled,      // boolean
  checked,      // boolean
  selected,     // boolean
  focused,      // boolean
  children,     // child nodes
}
```

Key details:
- Handles both `<node ...>...</node>` and self-closing `<node ... />`
- Returns `null` for `ERROR:` prefix from uiautomator
- Attribute names normalized: `content-desc` → `contentDesc`, `resource-id` → `resourceId`

### `src/prune.js` — Pruning + Ref Assignment

4-step pipeline that reduces tree size and assigns refs to interactive elements.

| Export | Description |
|--------|-------------|
| `prune(root)` | Returns `{tree, refMap}`. `refMap` is `Map<int, node>`. |

Pipeline:
1. **Assign refs** — walk tree, stamp `ref` on clickable/editable/scrollable nodes
2. **Collapse wrappers** — single-child Group/View/Layout with no text or ref → replaced by child
3. **Drop empty leaves** — no ref, no text, no contentDesc, no special state → removed
4. **Deduplicate** — same-class + same-text siblings at same level → keep first only (handles RecyclerView repeats)

Keep criteria: has ref, has text, has contentDesc, or has checked/selected/focused state.

Wrapper classes: `View`, `Group`, `FrameLayout`, `LinearLayout`, `RelativeLayout`, `ConstraintLayout`, `CoordinatorLayout`, `ViewGroup`.

### `src/aria.js` — YAML Formatter

Formats pruned tree as indented YAML-like text.

| Export | Description |
|--------|-------------|
| `formatTree(node, depth)` | Node → indented YAML string |
| `shortClass(className)` | Android class → short role name |

Output format:
```
- Button [ref=3] "Submit" (submit form) [checked, focused]
  - Text "Label"
```

27 class → role mappings:

| Android class | Role |
|---------------|------|
| `TextView`, `AppCompatTextView` | Text |
| `EditText`, `AppCompatEditText` | TextInput |
| `Button`, `AppCompatButton`, `MaterialButton` | Button |
| `ImageView` | Image |
| `ImageButton` | ImageButton |
| `CheckBox` | CheckBox |
| `Switch` | Switch |
| `RadioButton` | Radio |
| `ToggleButton` | Toggle |
| `SeekBar` | Slider |
| `ProgressBar` | Progress |
| `Spinner` | Select |
| `RecyclerView`, `ListView` | List |
| `ScrollView` | ScrollView |
| `LinearLayout`, `RelativeLayout`, `FrameLayout`, `ConstraintLayout`, `CoordinatorLayout`, `ViewGroup` | Group |
| `TabLayout` | TabList |
| `TabItem` | Tab |
| Unknown | Last segment of fully-qualified name |

States rendered: `checked`, `selected`, `focused`, `disabled` (inverse of `enabled`).

### `src/interact.js` — Interaction Primitives

All interactions go through `adb shell input`. Every function takes `opts` last for `{serial}`.

| Export | Description |
|--------|-------------|
| `tap(ref, refMap, opts)` | Bounds center → `input tap X Y` |
| `type(ref, text, refMap, opts)` | Focus tap + word-by-word input with KEYCODE_SPACE between words |
| `press(key, opts)` | Key event by name or keycode number |
| `swipe(x1, y1, x2, y2, duration, opts)` | Raw `input swipe` |
| `scroll(ref, direction, refMap, opts)` | Swipe within element bounds (up/down/left/right) |
| `longPress(ref, refMap, opts)` | Zero-distance swipe with 1000ms duration |

Key map for `press()`:

| Name | Keycode |
|------|---------|
| back | 4 |
| home | 3 |
| enter | 66 |
| delete | 67 |
| tab | 61 |
| escape | 111 |
| up/down/left/right | 19/20/21/22 |
| space | 62 |
| power | 26 |
| volup/voldown | 24/25 |
| recent | 187 |

Key details:
- `type()` uses word-by-word + KEYCODE_SPACE pattern (API 35+ fix — `input text` with spaces broken)
- `type()` shell-escapes `& | ; $ \` " ' \ < > ( )` per word
- `type()` taps to focus with 500ms settle delay before typing
- `scroll()` computes swipe within element bounds — center to one-third offset
- `longPress()` uses zero-distance swipe trick (same point, long duration)

### `src/index.js` — Public API

| Export | Description |
|--------|-------------|
| `connect(opts)` | Connect to device → page object |
| `snapshot(opts)` | One-shot: dump + parse + prune + format (no session state) |

`connect(opts)` options:
- `device` — serial string, or `'auto'` (default: first available device)

Page object:

| Method | Description |
|--------|-------------|
| `page.snapshot()` | Full pipeline → YAML string. Updates internal refMap. |
| `page.tap(ref)` | Tap by ref from last snapshot |
| `page.type(ref, text)` | Type text into ref |
| `page.press(key)` | Key event |
| `page.swipe(x1, y1, x2, y2, duration)` | Raw swipe |
| `page.scroll(ref, direction)` | Scroll within element |
| `page.longPress(ref)` | Long press by ref |
| `page.back()` | Press back button |
| `page.home()` | Press home button |
| `page.launch(pkg)` | `am start` with launcher intent |
| `page.screenshot()` | `screencap -p` → PNG Buffer |
| `page.close()` | No-op (ADB is stateless). Keeps API compatible with future daemon. |
| `page.serial` | Resolved device serial string |

Internal state:
- `_refMap` — updated on every `snapshot()` call, used by all ref-based interactions
- `_serial` — device serial, resolved once in `connect()`

## What the agent sees

A typical Android home screen snapshot:

```
- Group
  - ScrollView [ref=1]
    - Group
      - ViewPager (At a glance)
        - Group [ref=2]
          - Text [ref=3] "Mon, Feb 23" (Mon, Feb 23)
      - Text [ref=4] "Play Store" (Play Store)
      - Text [ref=5] "Gmail" (Gmail)
      - Text [ref=6] "Photos" (Photos)
      - Text [ref=7] "YouTube" (YouTube)
  - View (Home)
  - Group
    - Group
      - Text [ref=8] "Phone" (Phone)
      - Text [ref=9] "Messages" (Messages)
      - Text [ref=10] "Chrome" (Chrome)
    - Group [ref=11] (Google search)
      - Image [ref=12] (Google app)
      - Group
        - Image [ref=13] (Voice search)
        - ImageButton [ref=14] (Google Lens)
```

Compact, token-efficient, same format agents already understand from barebrowse.

## Tests

36 tests total (30 unit + 6 integration):

| Test file | Count | What |
|-----------|-------|------|
| `test/unit/xml.test.js` | 10 | parseBounds (3) + parseXml (7): single node, nested tree, self-closing, editable detection, empty/error input, all 12 attributes |
| `test/unit/prune.test.js` | 10 | Collapse wrappers, keep refs, drop empties, ref assignment, dedup, null root, contentDesc, states |
| `test/unit/aria.test.js` | 10 | shortClass mappings (5) + formatTree (5): all fields, nesting, states, disabled, empty |
| `test/integration/connect.test.js` | 6 | Page API, snapshot, launch, back, screenshot PNG, home |

Run all:
```bash
node --test test/unit/*.test.js test/integration/*.test.js
```

Integration tests auto-skip when no ADB device is available.

## Known Limitations

| Limitation | Detail |
|------------|--------|
| **Snapshot latency** | uiautomator dump takes 1-5 seconds depending on device speed. Emulators are slower. |
| **WebView content** | uiautomator tree is empty/shallow for WebView content. Flutter apps can crash uiautomator with StackOverflowError. |
| **Auth/tokens** | Cannot read app tokens on non-rooted devices. Agent must log in through UI. |
| **Refs are unstable** | Ref numbers reset per snapshot. Never cache refs across snapshots. |
| **No parallel snapshots** | uiautomator dump is a global lock — one at a time per device. |
| **Text input on API 35+** | `input text` with spaces is broken. Workaround: word-by-word + KEYCODE_SPACE (implemented). |
| **No multi-touch** | `adb shell input` only supports single-point gestures. Pinch-to-zoom not possible. |

## Requirements

- Node.js >= 22
- `adb` in PATH (from Android SDK platform-tools)
- ADB-connected device or emulator (`adb devices` shows it)

## Comparison with alternatives

| | baremobile | DroidRun | Appium | agent-device |
|---|---|---|---|---|
| **Approach** | ADB + uiautomator direct | A11y tree + ADB | WebDriver + UiAutomator2 | A11y tree |
| **Dependencies** | 0 | Python + many | Java server + heavy client | TypeScript + deps |
| **Setup** | `npm install` + ADB | pip install + many configs | Appium server + driver install | npm install + build |
| **Snapshot format** | Pruned YAML with refs | Structured tree | PageSource XML | Structured tree |
| **Agent-ready** | Yes — same format as barebrowse | Yes | No — raw XML | Yes |
| **Lines of code** | ~500 | ~5,000+ | Massive | Growing |
| **Philosophy** | Minimal, zero deps, vanilla JS | AI-native, funded startup | Enterprise test framework | Multi-platform |

---

## Roadmap

### Phase 1: Core library (DONE)
Implemented and tested. All modules in `src/`, 36 tests passing.

### Phase 2: bareagent adapter
`src/bareagent.js` — `createMobileTools(opts)` → `{tools, close}` for [bareagent](https://www.npmjs.com/package/bare-agent) Loop.

Planned tools:
| Tool | Description |
|------|-------------|
| `snapshot` | Take accessibility snapshot |
| `tap` | Tap element by ref |
| `type` | Type text into element |
| `press` | Press key (back, home, enter, etc.) |
| `scroll` | Scroll within element |
| `long_press` | Long press element |
| `swipe` | Raw swipe gesture |
| `launch` | Launch app by package name |
| `screenshot` | Take screenshot (base64 PNG) |
| `back` | Navigate back |
| `home` | Go to home screen |

Action tools auto-return snapshot after 300ms settle (same pattern as barebrowse bareagent adapter). Agent calls one tool, gets updated view back automatically.

### Phase 3: MCP server
`mcp-server.js` — JSON-RPC 2.0 over stdio, same as barebrowse. No SDK dependency.

Same tool set as bareagent adapter but following MCP conventions:
- Action tools return `"ok"`, agent calls `snapshot` explicitly
- Device selection via `connect` tool or auto-detect

Config for Claude Code:
```bash
claude mcp add baremobile -- npx baremobile mcp
```

Config for Claude Desktop / Cursor:
```json
{
  "mcpServers": {
    "baremobile": {
      "command": "npx",
      "args": ["baremobile", "mcp"]
    }
  }
}
```

### Phase 4: CLI session mode
`cli.js` + `src/daemon.js` + `src/session-client.js` — same architecture as barebrowse CLI.

```bash
baremobile open                          # Connect to device, start session
baremobile snapshot                      # Dump → .baremobile/page-*.yml
baremobile tap 5                         # Tap by ref
baremobile type 3 "hello world"          # Type into ref
baremobile press back                    # Press key
baremobile screenshot                    # → .baremobile/screenshot-*.png
baremobile launch com.android.settings   # Open app
baremobile close                         # End session
```

Daemon holds the session (device serial, refMap). Output files go to `.baremobile/`. Agents read them with file tools.

Skill file for Claude Code: `.claude/skills/baremobile/SKILL.md`

### Phase 5: WebView CDP bridge
The unique differentiator. When an app has a debug-enabled WebView, attach via CDP and use barebrowse's full ARIA + pruning pipeline inside it.

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
```

This bridges the native ↔ web gap that every other Android agent tool struggles with:
- Native parts: uiautomator tree (baremobile)
- WebView parts: CDP ARIA tree (barebrowse)
- Unified: single snapshot combining both

Discovery: scan `/proc/*/cmdline` or `cat /proc/net/unix` for `webview_devtools_remote_*` sockets. Requires the app to have called `WebView.setWebContentsDebuggingEnabled(true)` (common in debug builds).

### Phase 6: Advanced interactions
- `pinch(ref, scale)` — multi-touch via `sendevent` (requires device-specific input device discovery)
- `drag(fromRef, toRef)` — drag between two elements
- `clipboard(text)` — set clipboard content via `am broadcast`
- `notification()` — expand notification shade, snapshot, interact
- `rotate(orientation)` — set screen orientation
- `waitForText(text, timeout)` — poll snapshot until text appears
- `install(apkPath)` — install APK via `adb install`
- `uninstall(pkg)` — uninstall app

### Phase 7: Multi-device
- `listDevices()` already supports multi-device (filters ready devices)
- `connect({device: 'emulator-5554'})` already accepts specific serial
- Future: parallel sessions across multiple devices
- Future: device farm support (USB hub or cloud emulators)

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| ADB direct, not Appium | No Java server, no driver install, no 500MB of deps. ADB is already there. |
| uiautomator, not AccessibilityService | Works without app modification. No need to install a helper APK. |
| Zero dependencies | Same philosophy as barebrowse. `child_process.execFile` is enough. |
| YAML-like output, not JSON | Token-efficient, agents already know the format from barebrowse. |
| Refs reset per snapshot | Stable refs across snapshots would require diffing and tracking — complexity for minimal gain. Document as unstable. |
| Word-by-word typing | API 35+ broke `input text` with spaces. Word-by-word + KEYCODE_SPACE is the only reliable method. |
| dump-to-file + cat | `uiautomator dump /dev/tty` doesn't work on API 35+. Dump to temp file, cat it back via `exec-out`. |
| `exec-out` not `shell` | `adb shell` mangles `\r\n` line endings. `exec-out` gives raw binary-safe stdout. |
| Page object pattern | Same API shape as barebrowse's `connect()`. Agents learn one pattern, use it everywhere. |

## References

- [barebrowse](https://github.com/hamr0/barebrowse) — sister project for web browsing
- [Android uiautomator](https://developer.android.com/training/testing/other-components/ui-automator)
- [ADB documentation](https://developer.android.com/tools/adb)
- [DroidRun](https://github.com/droidrun/droidrun) — Python-based Android agent framework
- [agent-device](https://github.com/callstackincubator/agent-device) — TypeScript multi-platform
- [bareagent](https://www.npmjs.com/package/bare-agent) — LLM agent loop library
