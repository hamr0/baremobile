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
├── termux.js     — Termux detection + localhost ADB setup helper
├── termux-api.js — Termux:API: SMS, calls, location, camera, clipboard (no ADB)
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

8 modules, ~800 lines, 94 tests (78 unit + 16 integration).

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
| `screenSize(opts)` | Parse `wm size` → `{width, height}` |

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
| `tapXY(x, y, opts)` | Tap by raw pixel coordinates (no ref needed) |
| `tapGrid(cell, width, height, opts)` | Tap by grid cell label (e.g. "C5") |
| `buildGrid(width, height)` | Build labeled grid: 10 cols (A-J), auto rows. Returns `{cols, rows, cellW, cellH, resolve, text}` |
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
| `page.tapXY(x, y)` | Tap by pixel coordinates (vision fallback) |
| `page.tapGrid(cell)` | Tap by grid cell label, e.g. `"C5"` |
| `page.grid()` | Get grid object: `{cols, rows, cellW, cellH, resolve(cell), text}` |
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

94 tests total (78 unit + 16 integration):

| Test file | Count | What |
|-----------|-------|------|
| `test/unit/xml.test.js` | 12 | parseBounds (3) + parseXml (9): single node, nested tree, self-closing, editable detection, empty/error input, all 12 attributes, entity decoding |
| `test/unit/prune.test.js` | 10 | Collapse wrappers, keep refs, drop empties, ref assignment, dedup, null root, contentDesc, states |
| `test/unit/aria.test.js` | 10 | shortClass mappings (5) + formatTree (5): all fields, nesting, states, disabled, empty |
| `test/unit/interact.test.js` | 14 | buildGrid (7): column/row sizing, cell resolution, errors, text. Error handling (7): press/tap/scroll/type/longPress validation |
| `test/unit/termux.test.js` | 14 | isTermux detection, findLocalDevices parsing, adbPair/adbConnect command construction, resolveTermuxDevice error messages, localhost parsing with mixed device types |
| `test/unit/termux-api.test.js` | 18 | Module exports (16 functions), isAvailable detection, ENOENT errors for all 15 API functions on non-Termux systems |
| `test/integration/connect.test.js` | 16 | Page API, snapshot, launch, back, screenshot, grid, tapXY, tapGrid, intent, waitForText (2), tap by ref, type into field, scroll, swipe, home |

Run all:
```bash
node --test test/unit/*.test.js test/integration/*.test.js
```

Integration tests auto-skip when no ADB device is available.

## Verified Flows

Tested end-to-end on API 35 emulator, February 2025:

### Core ADB flows

| Flow | Steps | Result |
|------|-------|--------|
| **Open app, read screen** | `launch('com.android.settings')` → `snapshot()` | Clean YAML: "Settings", "Network & internet", "Connected devices" with refs on every tappable group |
| **Search by typing** | Settings → `tap(searchRef)` → `type(inputRef, 'wifi')` → `snapshot()` | TextInput shows `"wifi"`, results list: Wi-Fi, Wi-Fi hotspot, Wi-Fi Direct, Wi-Fi scanning, etc. |
| **Navigate back** | `press('back')` or `back()` from any screen | Returns to previous screen, snapshot confirms |
| **Scroll long lists** | Settings → `scroll(listRef, 'down')` → `snapshot()` | Scrolled past first items, new items visible (Connected devices → Apps → Notifications) |
| **Send a text message** | Messages → Start chat → `type(toRef, '5551234567')` → tap suggestion → `type(composeRef, 'Hello from baremobile!')` → `tap(sendRef)` | Message composed and sent. Snapshot confirms: "You said Hello from baremobile!" with timestamp. Full multi-step flow. |
| **Insert emoji** | In compose → `tap(emojiButtonRef)` → emoji panel opens with grid of tappable emojis (each has `[ref=N]`) → `tap(smileyRef)` → emoji inserted in TextInput | TextInput shows `"😀😂"` after tapping two emojis. Agent reads emoji names from contentDesc. |
| **Attach a file** | In compose → tap `+` button → tap Files → system file picker opens → navigate to Downloads → tap `test-attach.txt` | File selected from picker. (Emulator SMS rejects attachments, but the UI flow works end-to-end: picker → navigate → select → return to compose.) |
| **Dismiss dialogs** | "Attachments not supported" dialog appears → snapshot shows text + "OK" button with ref → `tap(okRef)` | Dialog dismissed. Agent reads dialog text, decides, taps. |
| **Screenshot capture** | `screenshot()` anywhere | PNG buffer with correct magic bytes, visual confirmation of screen state |
| **Home screen** | `home()` from any app | Returns to launcher, snapshot shows app grid + search bar |
| **App switching** | `press('recent')` | Opens recent apps view |
| **Toggle Bluetooth** | Settings → Connected devices → Connection preferences → Bluetooth → tap switch | Toggle OFF: switch disappears from tree, text changes. Toggle ON: goes through `[disabled]` transitional state, settles to `Switch [checked]` after ~2s. Full cycle verified. |
| **Tap by coordinates** | `tapXY(540, 1200)` on home screen | Tap lands correctly at pixel coordinates without ref |
| **Tap by grid cell** | `tapGrid('E10')` on home screen | Grid resolves cell to center coordinates, tap lands correctly |

### Termux ADB flows

| Flow | Steps | Result |
|------|-------|--------|
| **Localhost ADB connection** | `adb tcpip` → `adb forward` → `adb connect localhost:PORT` → `connect({termux: true})` | Device detected, serial `localhost:PORT` |
| **Snapshot via localhost** | `snapshot()` through localhost ADB | Same YAML output as USB ADB — identical pipeline |
| **Launch + tap + home** | `launch('com.android.settings')` → `tap(ref)` → `home()` | All interactions work through localhost serial |

All Core ADB flows apply identically to Termux ADB — same `adb.js`, different serial.

### Termux:API flows

| Flow | Steps | Result |
|------|-------|--------|
| **Battery status** | `batteryStatus()` inside Termux | JSON with percentage, status, temperature |
| **Clipboard round-trip** | `clipboardSet('test')` → `clipboardGet()` | Returns `"test"` |
| **Volume query** | `volumeGet()` | JSON array of stream volumes |
| **WiFi info** | `wifiInfo()` | JSON with SSID, BSSID, signal strength |
| **Vibrate** | `vibrate()` | Device vibrates |
| **SMS/calls/location/camera** | Not yet tested | Requires real device with SIM + GPS |

### What the agent handles without help

#### Core ADB + Termux ADB (all ADB-based screen control)

These apply to both Core ADB (USB/WiFi/emulator) and Termux ADB (localhost). Same `adb.js`, same pipeline.

| Obstacle | How it's handled |
|----------|-----------------|
| **Bloated accessibility tree** | 4-step pruning: collapse layout wrappers (FrameLayout, LinearLayout, ConstraintLayout, etc.), drop empty nodes, dedup RecyclerView/ListView repeats. Agent sees content, not structure. |
| **200+ Android widget classes** | 27 class→role mappings. `android.widget.TextView` → `Text`, `androidx.appcompat.widget.AppCompatButton` → `Button`, etc. Unknown → last segment. Agent sees roles, not Java packages. |
| **Text input broken on API 35+** | `input text "hello world"` fails with spaces. Workaround: split into words, type each with `input text`, inject KEYCODE_SPACE (62) between. Shell-escapes `& \| ; $ \` " ' \ < > ( )`. |
| **uiautomator dump broken on API 35+** | `dump /dev/tty` no longer works. Dumps to `/data/local/tmp/baremobile.xml`, cats it back via `exec-out` (binary-safe, no `\r\n` mangling). |
| **Finding the right element** | Every clickable/editable/scrollable node gets `[ref=N]`. Agent reads snapshot, picks ref, calls `tap(ref)`. Library resolves bounds center → `input tap X Y`. No coordinate math for the agent. |
| **Multi-step forms** | Tap to focus → type → tap next field → type → tap submit. Each snapshot gives fresh refs. Agent follows the UI just like a human. |
| **Confirmation dialogs** | Dialogs appear in the accessibility tree with their buttons. Agent reads "OK" / "Cancel" / "Allow", taps the right ref. |
| **App suggestions / autocomplete** | Suggestion chips appear as tappable elements with text and refs. Agent reads text, picks the right one. Verified with Messages recipient picker. |
| **Disabled elements** | Rendered as `[disabled]` in snapshot. Agent can read them but knows not to interact. |
| **Checked/selected/focused state** | Rendered as `[checked]`, `[selected]`, `[focused]`. Agent sees toggle states, active tabs, focused fields without extra queries. |
| **Scrollable content detection** | Scrollable containers get refs. Agent calls `scroll(ref, 'down')` — library computes swipe within element bounds. No guessing coordinates. |
| **Context menus** | `longPress(ref)` triggers long-press handlers. Menu appears in next snapshot. |
| **Binary output corruption** | Screenshots use `exec-out` (raw stdout), not `shell` (which mangles `\r\n`). PNG bytes arrive intact. |
| **Multi-device setups** | Every ADB call threads `-s serial`. `connect({device: 'emulator-5554'})` targets specific device. Default: auto-detect first available. |
| **ARIA tree fails (vision fallback)** | `screenshot()` → agent sees screen visually → `tapXY(x, y)` or `tapGrid('C5')` by coordinates. Grid: 10 cols (A-J), auto-sized rows. Covers Flutter crashes, empty WebViews, obfuscated custom views. |
| **XML entities in text** | uiautomator dump contains `&amp;`, `&lt;`, etc. Parser decodes all 5 XML entities at parse time. Snapshots show clean `Network & internet`, not `Network &amp; internet`. |
| **Screen unlock** | `press('power')` wakes screen, `swipe()` dismisses lock, `type()` enters PIN. Not automated yet but fully scriptable by agent. |

#### Termux ADB additional

| Obstacle | How it's handled |
|----------|-----------------|
| **Localhost device discovery** | `connect({termux: true})` auto-detects `localhost:PORT` devices via `adb devices`. No manual serial needed. |
| **Wireless debugging pairing** | `termux.js` provides `adbPair()` and `adbConnect()` helpers for one-time setup. |
| **Reconnection after reboot** | Wireless debugging disables on reboot. Agent or user must re-enable in Developer Options and re-pair. |

#### Termux:API (direct Android APIs)

No screen control. Direct API access via `termux-*` CLI commands — faster and more reliable than tapping through UI for supported actions.

| Capability | How it's handled |
|------------|-----------------|
| **SMS send/receive** | `smsSend(number, text)` sends directly. `smsList({limit, type})` reads inbox/sent/draft. No need to open Messages app. |
| **Phone calls** | `call(number)` initiates call via telephony API. |
| **Location** | `location({provider})` returns GPS/network/passive coordinates as JSON. |
| **Camera** | `cameraPhoto(file, {camera})` captures JPEG. Front/back camera selection. |
| **Clipboard** | `clipboardGet()` / `clipboardSet(text)` — direct access, no tapping. |
| **Contacts** | `contactList()` returns all contacts as JSON array. |
| **Notifications** | `notify(title, content, opts)` — create notifications with sound, priority, ongoing flag. |
| **Device info** | `batteryStatus()`, `volumeGet/Set()`, `wifiInfo()` — JSON responses. |
| **Hardware control** | `torch(on)` toggles flashlight. `vibrate({duration})` vibrates device. |
| **Availability check** | `isAvailable()` detects whether Termux:API addon is installed. |

### What still needs the agent's help

| Gap | Module | Why | Workaround |
|-----|--------|-----|------------|
| **Login / auth** | Core, Termux ADB | App tokens live in hardware-bound Keystore or locked SharedPrefs. Can't extract. | Agent logs in via UI: tap fields, type credentials, tap sign-in. Works for any app. |
| **WebView content** | Core, Termux ADB | uiautomator tree is empty/shallow inside WebViews. Flutter can crash it. | Roadmap Phase 5: CDP bridge for debug-enabled WebViews. |
| **CAPTCHAs** | Core, Termux ADB | No programmatic bypass. | Agent + vision model, or avoid CAPTCHA-gated flows. |
| **Multi-touch gestures** | Core, Termux ADB | `adb input` only supports single point. No pinch-to-zoom. | Roadmap Phase 6: `sendevent` for multi-touch. |
| **Keyboard language switching** | Core, Termux ADB | Text input assumes ASCII-compatible keyboard. | Agent can switch keyboard via Settings if needed. |
| **SMS/calls on emulator** | Termux:API | Emulator has no SIM — SMS and call commands require a real device. | Test on physical device with SIM card. |
| **GPS on emulator** | Termux:API | Emulator lacks GPS hardware — `location()` may fail or return mock data. | Test on physical device or use emulator location injection. |
| **Screen control** | Termux:API | Not available. Termux:API provides direct API access only — no snapshots, no tapping. | Use Termux ADB mode for screen control alongside Termux:API for direct APIs. |

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
- Android device or emulator with USB debugging enabled

### Android device setup (one-time)

1. **Enable Developer Options** — Settings → About phone → tap "Build number" 7 times
2. **Enable USB debugging** — Settings → Developer options → toggle "USB debugging" on
3. **Connect** — USB cable, tap "Allow" on the debugging prompt on device
4. **Verify** — `adb devices` shows your device as `device` (not `unauthorized`)

WiFi debugging: `adb tcpip 5555` while USB-connected, then `adb connect <device-ip>:5555`.
Emulators: no setup needed, `adb devices` shows them automatically.

### Connectivity modes

| Mode | Setup | Use case |
|------|-------|----------|
| **USB** | Plug in cable, tap "Allow" | Development, testing |
| **WiFi (same LAN)** | `adb tcpip 5555` once via USB, then `adb connect <phone-ip>:5555`. Unplug USB. | Home setup — phone and machine on same WiFi |
| **Remote (Tailscale/WireGuard)** | Install Tailscale on phone + machine. Both join same tailnet. `adb connect <tailscale-ip>:5555` | Phone at home, agent on a server elsewhere. ADB works over the virtual LAN. |
| **Termux (on-device)** | `pkg install android-tools`, enable wireless debugging, `adb pair` + `adb connect localhost:PORT`. `connect({termux: true})` | Autonomous agent on phone — no USB, no host machine |
| **Emulator** | `emulator -avd <name>` or Android Studio. Auto-detected by `adb devices`. | CI, development, no physical device |

**ADB does NOT work over the open internet.** The phone and the machine running baremobile must be on the same network — physical (WiFi/USB) or virtual (Tailscale/WireGuard VPN). Tailscale is free and makes this trivial.

### Integration with multis

The primary integration path is through [multis](https://github.com/hamr0/multis) — a local-first AI agent that lives in your chat apps (Telegram, WhatsApp, Signal, Discord via Beeper bridges).

```
You (anywhere, any device, any messenger)
    ↓ message via Telegram/WhatsApp/Signal/Beeper
multis (running on your machine, has baremobile as a skill)
    ↓ bare-agent tool call
baremobile (connects via ADB)
    ↓ WiFi ADB or Tailscale
Your Android phone
```

**How it works:** multis already has a skill system and uses bare-agent for LLM tool calling. baremobile's bareagent adapter (`createMobileTools()`) registers phone control tools with multis. You message multis from any chat: "turn on bluetooth" → multis LLM decides to use baremobile tools → snapshot → tap → tap → tap → replies "Bluetooth is on."

**You never talk to baremobile directly.** You talk to multis through any messenger. multis uses baremobile as one of its skills, alongside shell exec, file read, document search, etc.

**Requirements for this flow:**
1. Phone: USB debugging enabled
2. Phone + multis machine: same network (home WiFi or Tailscale)
3. One-time: `adb tcpip 5555` via USB, then `adb connect <phone-ip>:5555`, unplug
4. multis running as daemon with baremobile skill configured
5. You message from anywhere — phone, laptop, another country

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
6 modules, ~500 lines, 36 tests. connect → snapshot → tap/type/press/swipe/scroll.

### Phase 1.5: Vision fallback + polish (DONE)
`tapXY`, `tapGrid`, `buildGrid`, `screenSize`, XML entity decoding. 48 tests.

### Phase 1.6: Waiting + intents (DONE)
- `waitForText(text, timeout)` — poll snapshot until text appears. 51 tests.
- `waitForState(ref, state, timeout)` — poll for element state change (enabled/disabled/checked/unchecked/focused/selected)
- `page.intent(action, extras?)` — deep navigation via Android intents (supports --es, --ei, --ez extras)
- Documented platform gaps (switch removal, transitional states) in context.md
- Documented common intents, vision fallback pattern, waiting patterns in context.md

### Phase 2: Termux ADB setup (DONE)
On-device control via Termux + localhost ADB. **Not a separate transport** — same `adb.js`, different serial.

**Key insight:** Termux can't control the phone directly (no `INJECT_EVENTS` permission). But Termux can install `android-tools` and run `adb connect localhost:PORT` to reach wireless debugging. ADB provides the permission escalation. All existing code works unchanged — the serial is just `localhost:PORT` instead of `emulator-5554` or `192.168.1.5:5555`.

**What `termux.js` does:** detect Termux environment, find/connect localhost ADB devices, provide setup instructions. It's a setup helper, not a transport.

**What `connect({termux: true})` does:** calls `resolveTermuxDevice()` to get a `localhost:PORT` serial, then passes it to the standard ADB flow. Auto-detects Termux when no device is specified.

**POC results (validated on emulator):**
- `uiautomator dump` via localhost ADB: **works**
- `input tap` via localhost ADB: **works**
- Wireless debugging survives reboot: **no** — must re-enable after each reboot
- Permissions: wireless debugging must be enabled manually in Developer Options

**Two modes of baremobile (both use `adb.js`):**

| Mode | Where it runs | Serial | Setup |
|------|--------------|--------|-------|
| **ADB** | Host machine | USB serial, IP:port, emulator-* | USB debugging or `adb tcpip` |
| **Termux** | On the phone | `localhost:PORT` | Wireless debugging + `adb pair` + `adb connect` |

### Phase 2.5: Termux:API (DONE)
Lightweight phone actions via [Termux:API](https://wiki.termux.com/wiki/Termux:API) — **no ADB required, no screen control.**

Termux:API is a companion addon that exposes Android APIs as CLI commands. These are direct API calls, faster and more reliable than tapping through the UI. Useful when an agent just needs to "send a text" or "make a call."

`src/termux-api.js` — 16 functions wrapping `termux-*` commands:

| Export | Termux command | What |
|--------|---------------|------|
| `smsSend(number, text, opts?)` | `termux-sms-send -n NUMBER` | Send SMS (supports SIM slot) |
| `smsList(opts?)` | `termux-sms-list` | List SMS (limit, offset, type filter) |
| `call(number)` | `termux-telephony-call NUMBER` | Make a phone call |
| `location(opts?)` | `termux-location` | GPS/network/passive location |
| `cameraPhoto(file, opts?)` | `termux-camera-photo FILE` | Take JPEG photo |
| `clipboardGet()` | `termux-clipboard-get` | Read clipboard |
| `clipboardSet(text)` | `termux-clipboard-set` | Write clipboard |
| `contactList()` | `termux-contact-list` | List all contacts (JSON) |
| `notify(title, content, opts?)` | `termux-notification` | Show notification (id, ongoing, sound, priority) |
| `batteryStatus()` | `termux-battery-status` | Battery info (JSON) |
| `volumeGet()` | `termux-volume` | Get all stream volumes (JSON) |
| `volumeSet(stream, value)` | `termux-volume STREAM VALUE` | Set stream volume |
| `wifiInfo()` | `termux-wifi-connectioninfo` | WiFi connection info (JSON) |
| `torch(on)` | `termux-torch on/off` | Toggle flashlight |
| `vibrate(opts?)` | `termux-vibrate` | Vibrate device |
| `isAvailable()` | `which termux-battery-status` | Detect Termux:API presence |

**What this is NOT:** UI automation. No screen reading, no tapping, no navigating apps. It's direct Android API access — complements ADB screen control, doesn't replace it.

**Three levels of phone control:**

| Level | Needs ADB | Screen control | Use case |
|-------|-----------|----------------|----------|
| **Termux:API** | No | No | SMS, calls, location, camera, clipboard — fast, reliable, no setup |
| **ADB (from host)** | Yes (USB/WiFi) | Yes | QA, testing, development |
| **ADB (from Termux)** | Yes (localhost) | Yes | Autonomous agent on phone |

### Development order & consumption model

baremobile has three capability layers. All must be complete before bareagent wires them together.

```
baremobile core (adb)     — DONE — QA, host controls phone via USB/WiFi
baremobile termux         — DONE — Termux:API (SMS, calls, location, no ADB)
baremobile termux adb     — DONE — on-device screen control via localhost ADB
       ↓ all three complete
bareagent adapter         — absorbs all three as one tool set
       ↓
multis                    — consumes baremobile via bareagent
```

**baremobile core (adb)** is the QA tool — kept separate, used from a host machine.
**baremobile termux** is direct Android API access — no screen, no ADB, Termux:API only.
**baremobile termux adb** is full on-device control — screen + interactions via localhost ADB.
**bareagent** comes last — it wires all three into a single tool set. The bareagent prompt handles routing.
**multis** consumes baremobile through bareagent. User messages from any messenger → multis → bareagent → phone.

### Phase 3: MCP server (for Claude Code/Desktop users)
`mcp-server.js` — JSON-RPC 2.0 over stdio, same as barebrowse. Uses ADB transport (local QA/dev use case).

Config for Claude Code:
```bash
claude mcp add baremobile -- npx baremobile mcp
```

### Phase 4: CLI session mode
`cli.js` + `src/daemon.js` + `src/session-client.js` — same architecture as barebrowse CLI. Uses ADB transport.

### Phase 5: bareagent adapter
`src/bareagent.js` — `createMobileTools(opts)` → `{tools, close}` for [bareagent](https://www.npmjs.com/package/bare-agent) Loop.

**bareagent uses `connect()` which auto-detects the environment.** On a host machine → ADB mode. Inside Termux → localhost ADB. Termux:API tools available as bonus when detected. multis consumes baremobile through bareagent tools.

UI control tools (~15): snapshot, tap, tap_xy, tap_grid, type, press, scroll, long_press, swipe, launch, intent, screenshot, back, home, wait_for_text.

Termux:API tools (~10): sms_send, sms_list, call, location, clipboard, contacts, notify, battery, volume, camera.

Action tools auto-return snapshot after 300ms settle (same pattern as barebrowse bareagent adapter). Termux:API tools return JSON directly.

### Phase 6: WebView CDP bridge
When an app has a debug-enabled WebView, attach via CDP and use barebrowse's ARIA + pruning pipeline inside it.

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
```

Native parts: uiautomator tree (baremobile). WebView parts: CDP ARIA tree (barebrowse). Unified snapshot.

### Phase 7: Advanced interactions
- `pinch(ref, scale)` — multi-touch via `sendevent`
- `drag(fromRef, toRef)` — drag between two elements
- `clipboard(text)` — set clipboard content via `am broadcast`
- `notification()` — expand notification shade, snapshot, interact

### Phase 8: Multi-device
- Parallel sessions across multiple devices
- Device farm support (USB hub or cloud emulators)

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

## Future Features Needed

### Done (shipped in 0.2.0)

- ~~HTML entity decoding~~ — `&amp;` → `&` in xml.js, all 5 XML entities
- ~~Screenshot vision fallback~~ — `tapXY(x, y)`, `tapGrid(cell)`, `buildGrid()`, `page.grid()` shipped
- ~~Coordinate tapping~~ — `page.tapXY()` for vision model use

### Core Improvements

**`waitForText(text, timeout)`** — Poll snapshot until text appears or timeout. Essential for confirming async state changes (e.g. Bluetooth toggle goes through a `[disabled]` transitional state before settling). Without this, agents must sleep arbitrary durations and re-snapshot manually. Also useful for: app launch confirmation, dialog appearance, network state changes.

**`waitForState(ref, state, timeout)`** — Wait for a specific element state (enabled, checked, unchecked, focused). Complements waitForText for cases where the text doesn't change but the state does.

**Intent-based deep navigation** — `page.launch(pkg)` only opens the main activity. Android supports intent shortcuts like `am start -a android.settings.BLUETOOTH_SETTINGS` to jump directly into subsections. Add `page.intent(action, extras?)` or document common intent patterns in context.md so agents don't need 4 navigation steps to reach Bluetooth settings.

### Platform Gaps to Document

**Switch removal when unchecked** — Android sometimes removes unchecked Switch/Toggle elements from the accessibility tree entirely rather than showing `Switch [unchecked]`. Observed on Bluetooth settings page: when BT is off, the Switch element disappears and only `Text "Use Bluetooth"` remains. Agents need to know: "no switch present = off" rather than looking for `[unchecked]`. Add to context.md and agent integration guide.

**Transitional disabled states** — System settings toggles go through a `[disabled]` state during async operations (observed: Bluetooth enabling). Agents should snapshot again after 1-2s when they see `[disabled]` on a toggle they just tapped. Document this pattern.

### Why not iPhone

Investigated and decided against iOS support. The platform doesn't allow it without unreasonable friction.

#### How iOS accessibility actually works

iOS has a rich accessibility tree — same one VoiceOver uses. The technical chain:

```
iOS App → Apple Accessibility Framework → XCUITest (XCUIElementAttributes) → WebDriverAgent → HTTP API
```

1. **Apple Accessibility Framework** — built into iOS. Every app exposes element types, labels, values, traits, frames. The tree is there and it's good.
2. **XCUITest** — Apple's official UI testing framework. Reads the accessibility tree through public APIs (`XCUIElementAttributes` protocol). Not private APIs, fully sanctioned.
3. **WebDriverAgent (WDA)** — a server app (originally Facebook, now Appium-maintained) that wraps XCUITest in an HTTP/WebDriver API on port 8100. Send HTTP requests → WDA calls XCUITest → reads accessibility tree → returns JSON.
4. **Everyone else** — Appium, CogniSim, DroidRun (when they ship) — are just HTTP clients talking to WDA. CogniSim converts the tree to HTML + numbered overlays. Same data, different presentation.

**The tree is equivalent to Android's uiautomator dump.** Element types, labels, values, enabled/disabled/selected states, frames/bounds. Max nesting depth: 62 levels (XCTest hard limit, default 50).

#### The problem isn't the tree — it's getting WDA onto the device

**Android setup:** Enable USB debugging (one toggle). Done. `adb` talks to built-in services. Zero install on device.

**iOS setup to access that same accessibility tree:**
1. Own a Mac (required — Xcode is macOS-only)
2. Install Xcode (~25GB download)
3. Create Apple Developer account
4. Build and sideload WebDriverAgent onto iPhone via Xcode
5. On iPhone: Settings → General → Device Management → Trust the certificate
6. **Free tier: re-sign WDA every 7 days** (certificate expires). Paid: $99/year for 1-year signing.
7. WDA must be running on the iPhone for any automation to work

Alternative sideload tools (skip Xcode GUI): `pymobiledevice3`, `ios-deploy`, `go-ios`, `tidevice`, `ios-app-signer`. All still need Mac + developer certificate.

#### What the competition actually does

- **Appium XCUITest driver** — wraps WDA, adds convenience. Same Mac + Xcode + sideload requirement.
- **CogniSim** — says "iOS Support: Coming soon!" — not shipped. Will use Appium/WDA when they do.
- **DroidRun** — says "iOS: experimental, full support on roadmap" — not shipped. Same WDA path.
- **Cloud farms** (BrowserStack, Sauce Labs, Corellium) — hide the WDA setup by running it for you. Expensive.

Nobody has solved the WDA friction. They either haven't shipped iOS, or they require Mac + Xcode.

#### Remote iOS is worse

- `idevicescreenshot` (libimobiledevice) — USB only
- WDA over network — still needs sideload first
- `pymobiledevice3` network pairing — iOS 17+, flaky
- Cloud device farms — expensive, vendor lock-in

#### Decision

Android is open by design — USB debugging exposes everything an agent needs. Apple gates the equivalent behind Mac + Xcode + sideload + certificate management. The accessibility tree is there and it's good — Apple just won't let you read it without jumping through hoops.

This isn't a technical problem we can solve. It's a platform policy. We'd be building a wrapper around WDA's friction, not eliminating it. Not worth it.

If Apple ever exposes accessibility APIs via USB (like Android's `adb` + `uiautomator`), revisit immediately. Until then, Android only.

## References

- [barebrowse](https://github.com/hamr0/barebrowse) — sister project for web browsing
- [Android uiautomator](https://developer.android.com/training/testing/other-components/ui-automator)
- [ADB documentation](https://developer.android.com/tools/adb)
- [DroidRun](https://github.com/droidrun/droidrun) — Python-based Android agent framework
- [agent-device](https://github.com/callstackincubator/agent-device) — TypeScript multi-platform
- [bareagent](https://www.npmjs.com/package/bare-agent) — LLM agent loop library
