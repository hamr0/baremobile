# baremobile -- Blueprint

## What this is

baremobile gives AI agents control of Android and iOS devices. Vanilla JS, zero dependencies, ES modules. Android uses ADB directly via `child_process.execFile`; iOS uses WebDriverAgent (WDA) over HTTP via `fetch()`. Same pattern as [barebrowse](https://github.com/hamr0/barebrowse) -- take a snapshot, get a pruned accessibility tree with `[ref=N]` markers, tap/type/swipe by ref.

---

## Architecture

```
src/
  adb.js           -- ADB transport: exec, device discovery, XML dump
  aria.js          -- Format tree as YAML with [ref=N] markers
  daemon.js        -- Background daemon for CLI session mode
  index.js         -- Public API: connect(opts) -> page object (Android)
  interact.js      -- tap, type, press, swipe, scroll, long-press (Android)
  ios-cert.js      -- WDA cert expiry tracking (7-day free Apple ID certs)
  ios.js           -- iOS API: connect(opts) -> page object (WDA over HTTP)
  prune.js         -- Pruning pipeline + ref assignment
  session-client.js -- Client for daemon IPC (CLI <-> daemon)
  setup.js         -- Interactive setup wizard (Android: emulator/USB/WiFi/Termux + iOS)
  termux-api.js    -- Termux:API: SMS, calls, location, camera, clipboard (no ADB)
  termux.js        -- Termux detection + localhost ADB setup helper
  usbmux.js        -- Node.js usbmuxd client for iOS USB connection
  xml.js           -- Zero-dep XML parser (pure, no I/O)

mcp-server.js      -- MCP server: JSON-RPC 2.0 over stdio, 11 tools, dual-platform
cli.js             -- CLI entry point: baremobile <command> [options]
```

14 source files in `src/`, 2 top-level entry points, ~1,400 lines total.

---

## How it works

### Snapshot pipeline (shared by both platforms)

```
Android:  adb exec-out uiautomator dump  ->  XML string   (adb.js)
          parseXml(xml)                   ->  node tree     (xml.js)

iOS:      fetch('/source')               ->  XML string   (ios.js)
          translateWda(xml)              ->  node tree     (ios.js)

Both:     prune(root)                    ->  pruned tree + refMap  (prune.js)
          formatTree(tree)               ->  YAML string           (aria.js)
```

### Interactions

```
Android:  resolve ref -> bounds center -> adb shell input tap X Y   (interact.js)
iOS:      resolve ref -> bounds center -> W3C pointer action        (ios.js)
```

### Page object

```js
const page = await connect();       // auto-detect device
const snap = await page.snapshot();  // YAML with [ref=N] markers
await page.tap(3);                   // tap element ref=3
await page.type(5, 'hello');         // focus + type text
await page.press('back');            // key event
await page.scroll(1, 'down');        // swipe within element bounds
await page.launch('com.android.settings');
```

Same API shape for both platforms. Import from `src/index.js` (Android) or `src/ios.js` (iOS).

---

## Module details

### `src/adb.js` -- ADB Transport

Thin wrapper around `child_process.execFile('adb', ...)`.

| Export | Description |
|--------|-------------|
| `exec(args, opts)` | Raw adb command. Threads `-s serial` if set. Supports `encoding: 'buffer'` for binary output. |
| `shell(cmd, opts)` | Shortcut for `exec(['shell', cmd])` |
| `listDevices()` | Parse `adb devices -l`, return `[{serial, state, type}]`. Filters to `state === 'device'`. |
| `dumpXml(opts)` | `exec-out` with dump-to-file + cat pattern. 15s timeout. Returns XML string. |
| `screenSize(opts)` | Parse `wm size` -> `{width, height}` |

Key details:
- `exec-out` for binary-safe stdout (not `shell` which mangles line endings)
- Dump path: `/data/local/tmp/baremobile.xml`
- `listDevices` infers type from serial prefix (`emulator-` -> emulator, else usb)
- 4MB maxBuffer for large UI trees

### `src/xml.js` -- XML Parser

Zero-dependency regex-based parser for uiautomator dump XML.

| Export | Description |
|--------|-------------|
| `parseXml(xml)` | XML string -> node tree. Returns `null` on empty/error input. |
| `parseBounds(str)` | `"[0,0][1080,1920]"` -> `{x1, y1, x2, y2}` or `null` |

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
- Attribute names normalized: `content-desc` -> `contentDesc`, `resource-id` -> `resourceId`

### `src/prune.js` -- Pruning + Ref Assignment

4-step pipeline that reduces tree size and assigns refs to interactive elements.

| Export | Description |
|--------|-------------|
| `prune(root)` | Returns `{tree, refMap}`. `refMap` is `Map<int, node>`. |

Pipeline:
1. **Assign refs** -- walk tree, stamp `ref` on clickable/editable/scrollable nodes
2. **Collapse wrappers** -- single-child Group/View/Layout with no text or ref -> replaced by child
3. **Drop empty leaves** -- no ref, no text, no contentDesc, no special state -> removed
4. **Deduplicate** -- same-class + same-text siblings at same level -> keep first only (handles RecyclerView repeats)

Keep criteria: has ref, has text, has contentDesc, or has checked/selected/focused state.

Wrapper classes: `View`, `Group`, `FrameLayout`, `LinearLayout`, `RelativeLayout`, `ConstraintLayout`, `CoordinatorLayout`, `ViewGroup`.

### `src/aria.js` -- YAML Formatter

Formats pruned tree as indented YAML-like text.

| Export | Description |
|--------|-------------|
| `formatTree(node, depth)` | Node -> indented YAML string |
| `shortClass(className)` | Android/iOS class -> short role name |

Output format:
```
- Button [ref=3] "Submit" (submit form) [checked, focused]
  - Text "Label"
```

Class -> role mappings (27 Android + 29 iOS):

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

iOS types mapped: Button, Text, Cell, Switch, TextField, SearchField, Key, Icon, Keyboard, TabBar, Toolbar, Sheet, Picker, PageIndicator, StatusBar, and others (29 total). Image NOT in CLICKABLE_TYPES (decorative); Key + Icon ARE clickable.

States rendered: `checked`, `selected`, `focused`, `disabled` (inverse of `enabled`).

### `src/interact.js` -- Interaction Primitives

All interactions go through `adb shell input`. Every function takes `opts` last for `{serial}`.

| Export | Description |
|--------|-------------|
| `tap(ref, refMap, opts)` | Bounds center -> `input tap X Y` |
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
- `type()` uses word-by-word + KEYCODE_SPACE pattern (API 35+ fix -- `input text` with spaces broken)
- `type()` shell-escapes `& | ; $ \` " ' \ < > ( )` per word
- `type()` taps to focus with 500ms settle delay before typing
- `scroll()` computes swipe within element bounds -- center to one-third offset
- `longPress()` uses zero-distance swipe trick (same point, long duration)

### `src/index.js` -- Public API (Android)

| Export | Description |
|--------|-------------|
| `connect(opts)` | Connect to device -> page object |
| `snapshot(opts)` | One-shot: dump + parse + prune + format (no session state) |

`connect(opts)` options:
- `device` -- serial string, or `'auto'` (default: first available device)
- `termux` -- `true` to auto-detect `localhost:PORT` via Termux

Page object methods:

| Method | Description |
|--------|-------------|
| `page.snapshot()` | Full pipeline -> YAML string. Updates internal refMap. |
| `page.tap(ref)` | Tap by ref from last snapshot |
| `page.type(ref, text)` | Type text into ref |
| `page.press(key)` | Key event |
| `page.swipe(x1, y1, x2, y2, duration)` | Raw swipe |
| `page.scroll(ref, direction)` | Scroll within element |
| `page.longPress(ref)` | Long press by ref |
| `page.back()` | Press back button |
| `page.home()` | Press home button |
| `page.launch(pkg)` | `am start` with launcher intent |
| `page.intent(action, extras?)` | Deep navigation via Android intents |
| `page.tapXY(x, y)` | Tap by pixel coordinates (vision fallback) |
| `page.tapGrid(cell)` | Tap by grid cell label, e.g. `"C5"` |
| `page.grid()` | Get grid object: `{cols, rows, cellW, cellH, resolve(cell), text}` |
| `page.screenshot()` | `screencap -p` -> PNG Buffer |
| `page.waitForText(text, timeout)` | Poll snapshot until text appears |
| `page.waitForState(ref, state, timeout)` | Poll for element state change |
| `page.close()` | No-op (ADB is stateless) |
| `page.serial` | Resolved device serial string |

### `src/ios.js` -- iOS API (WDA)

Same page-object pattern as Android. Uses `fetch()` to communicate with WDA running on device.

```js
import { connect } from 'baremobile/src/ios.js';

const page = await connect();             // auto-discover WDA
const snap = await page.snapshot();        // WDA /source -> translateWda -> prune -> YAML
await page.tap(1);                         // coordinate tap via bounds center
await page.type(2, 'hello');               // coordinate tap to focus + WDA keys
await page.scroll(0, 'down');              // coordinate-based swipe within bounds
await page.back();                         // find back button in refMap or swipe-from-left
await page.home();                         // WDA /wda/homescreen
await page.screenshot();                   // WDA /screenshot -> PNG buffer
await page.unlock(passcode);              // detect locked state, enter passcode
page.close();
```

Auto-discovery in `connect()`:
1. Cached WiFi -- reads `/tmp/baremobile-ios-wifi`, tries direct HTTP
2. USB discovery -- Node.js proxy via usbmuxd, gets WiFi IP from `/status`, caches it
3. Fallback -- `localhost:8100`

### `src/termux.js` -- Termux ADB Helper

Detects Termux environment, finds/connects localhost ADB devices.

| Export | Description |
|--------|-------------|
| `isTermux()` | Detect Termux environment |
| `findLocalDevices()` | Parse `adb devices` for `localhost:PORT` entries |
| `adbPair(code, port)` | Wireless debugging pairing helper |
| `adbConnect(port)` | Connect to localhost ADB |
| `resolveTermuxDevice()` | Auto-detect localhost serial for `connect({termux: true})` |

### `src/termux-api.js` -- Termux:API

16 functions wrapping `termux-*` CLI commands. No ADB required, no screen control.

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
| `notify(title, content, opts?)` | `termux-notification` | Show notification |
| `batteryStatus()` | `termux-battery-status` | Battery info (JSON) |
| `volumeGet()` | `termux-volume` | Get all stream volumes (JSON) |
| `volumeSet(stream, value)` | `termux-volume STREAM VALUE` | Set stream volume |
| `wifiInfo()` | `termux-wifi-connectioninfo` | WiFi connection info (JSON) |
| `torch(on)` | `termux-torch on/off` | Toggle flashlight |
| `vibrate(opts?)` | `termux-vibrate` | Vibrate device |
| `isAvailable()` | `which termux-battery-status` | Detect Termux:API presence |

### `src/usbmux.js` -- usbmuxd Client

Node.js TCP proxy via `/var/run/usbmuxd`. Replaces pymobiledevice3 port forwarder (which crashed with socket cleanup race conditions).

- Binary protocol: version 0 for Connect (type=2), version 1 plist (type=8) for ListDevices
- Handles 10+ concurrent requests, zero crashes

### `src/ios-cert.js` -- Cert Expiry Tracking

Tracks WDA signing timestamp (written by `baremobile ios resign`). Warns when cert is >6 days old (7-day free Apple ID cert expiry). Warning prepended to first iOS snapshot in MCP server.

### `src/setup.js` -- Setup Wizard

Interactive setup for both platforms. `baremobile setup` detects what is already configured and guides through remaining steps.

- Android: sub-menu with 4 modes — Emulator (SDK install + AVD creation + boot), USB (device detection with unauthorized/offline handling), WiFi (TCP/IP connect), Termux (on-device guide). `ensureAdb()` installs adb via package manager. `ensureSdk()` installs full SDK for emulator use. `findSdkRoot()` and `findSdkTool()` locate existing SDK installations.
- iOS: check pymobiledevice3, USB device, developer mode, WDA installed, tunnel running, verify WDA connection
- `restartWda()` — non-interactive WDA restart for auto-recovery. Two-tier: tier-1 reads stored RSD addr/port from PID file, restarts just WDA+forward in ~3s without pkexec; tier-2 falls back to full tunnel restart if RSD missing or tunnel dead. Called by MCP server on second iOS connection failure.
- PID file (`/tmp/baremobile-ios-pids`) stores tunnel/WDA/forward PIDs on line 1, RSD addr/port on line 2. `loadPids()` is backward-compatible with legacy 1-line format.

### `src/daemon.js` -- CLI Daemon

Background process for CLI session mode. Holds device connection, buffers logcat entries.

- IPC via Unix domain socket
- Logcat: spawns `adb logcat` in background, buffers entries, flushes to `.baremobile/logcat-*.json`
- Session state in `.baremobile/session.json`

### `src/session-client.js` -- Session Client

IPC client for CLI -> daemon communication. Used by `cli.js` to send commands to a running daemon.

### `mcp-server.js` -- MCP Server

JSON-RPC 2.0 over stdio. 11 tools: `snapshot`, `tap`, `type`, `press`, `scroll`, `swipe`, `long_press`, `launch`, `screenshot`, `back`, `find_by_text`. All accept optional `platform: "android" | "ios"`. Auto-restarts WDA tunnel on second iOS connection failure via `restartWda()`.

Per-platform lazy pages -- `connect()` on first tool call per platform. Action tools return `'ok'`, agent calls `snapshot` explicitly to observe. Large snapshots (>30K chars) saved to `.baremobile/screen-{timestamp}.yml`.

Config:
```bash
claude mcp add baremobile -- node mcp-server.js
```

### `cli.js` -- CLI

Full command set: `open`, `close`, `status`, `snapshot`, `screenshot`, `tap`, `tap-xy`, `tap-grid`, `type`, `press`, `scroll`, `swipe`, `long-press`, `launch`, `intent`, `back`, `home`, `wait-text`, `wait-state`, `grid`, `logcat`, `mcp`, `setup`, `ios resign`, `ios teardown`.

`--platform=ios` for iOS. `--json` for machine-readable output.

---

## Platforms

### Android

Three modes, all using the same `adb.js` transport:

| Mode | Where it runs | Serial | Setup |
|------|--------------|--------|-------|
| **Host ADB** | Host machine | USB serial, IP:port, emulator-* | USB debugging or `adb tcpip` |
| **Termux ADB** | On the phone | `localhost:PORT` | Wireless debugging + `adb pair` + `adb connect` |
| **Termux:API** | On the phone | N/A (no ADB) | `pkg install termux-api` |

**Host ADB** is the primary mode -- QA, testing, development. **Termux ADB** enables autonomous on-device agents (same pipeline, different serial). **Termux:API** provides direct Android API access (SMS, calls, location) without screen control.

Requirements:
- Node.js >= 22
- `adb` in PATH (from Android SDK platform-tools)
- USB debugging enabled on device

### iOS

WDA-based, USB required. Same `snapshot() -> tap(ref)` pattern as Android.

`translateWda()` converts WDA `/source` XML into Android node shape, then shared `prune()` + `formatTree()` produce identical YAML. Runtime is pure `fetch()` -- zero Python dependency.

Requirements:
- iPhone with Developer Mode enabled
- WDA signed and installed (free Apple ID, 7-day cert, re-sign weekly via `baremobile ios resign`)
- pymobiledevice3 (Python 3.12) for setup only -- tunnel, DDI mount, WDA launch
- USB cable (required -- WiFi tunnel needs Mac/Xcode, WONTFIX on Linux)

### Connectivity modes

| Mode | Setup | Use case |
|------|-------|----------|
| **USB** | Plug in cable, tap "Allow" | Development, testing |
| **WiFi (same LAN)** | `adb tcpip 5555` once via USB, then `adb connect <phone-ip>:5555` | Home setup -- phone and machine on same WiFi |
| **Remote (Tailscale/WireGuard)** | Tailscale on phone + machine, same tailnet. `adb connect <tailscale-ip>:5555` | Phone at home, agent on a server elsewhere |
| **Termux (on-device)** | `pkg install android-tools`, wireless debugging, `adb pair` + `adb connect localhost:PORT` | Autonomous agent on phone |
| **Emulator** | `emulator -avd <name>` or Android Studio. Auto-detected. | CI, development |
| **iOS USB** | USB cable + `baremobile setup` | iOS QA/testing |

ADB does NOT work over the open internet. Phone and machine must be on the same network -- physical (WiFi/USB) or virtual (Tailscale/WireGuard VPN).

### Integration with multis

```
You (anywhere, any device, any messenger)
    | message via Telegram/WhatsApp/Signal/Beeper
multis (running on your machine, has baremobile as a skill)
    | bare-agent tool call
baremobile (connects via ADB or WDA)
    | WiFi ADB, Tailscale, or USB
Your phone
```

multis has a skill system using bare-agent for LLM tool calling. baremobile's bareagent adapter (`createMobileTools()`) registers phone control tools. You message multis from any chat -- multis decides to use baremobile, controls the phone, replies with results. You never talk to baremobile directly.

---

## Tests

~186 tests (unit + integration). Run all:

```bash
node --test test/unit/*.test.js test/integration/*.test.js
```

Test files:

| File | What |
|------|------|
| `test/unit/xml.test.js` | XML parsing, bounds, entities |
| `test/unit/prune.test.js` | Collapse, keep, drop, dedup, refs, internal name filter |
| `test/unit/aria.test.js` | shortClass mappings, formatTree |
| `test/unit/interact.test.js` | buildGrid, error handling |
| `test/unit/termux.test.js` | Termux detection, device discovery |
| `test/unit/termux-api.test.js` | Module exports, isAvailable, ENOENT |
| `test/unit/ios.test.js` | translateWda, prune pipeline, CLASS_MAP, keyboard/Unicode/path stripping, accessible attr refs, scale factor |
| `test/unit/usbmux.test.js` | usbmuxd protocol, proxy |
| `test/unit/mcp.test.js` | MCP server tools |
| `test/unit/setup.test.js` | Setup wizard helpers, loadPids format parsing, findSdkRoot, findSdkTool |
| `test/unit/cli.test.js` | CLI argument parsing |
| `test/integration/connect.test.js` | End-to-end against emulator |
| `test/integration/cli.test.js` | CLI session lifecycle |

Integration tests auto-skip when no ADB device is available.

### iOS test plans

Template at `test/ios-test-plan.template.md`. Copy to `test/plans/[app-name].md` per app. Feed to any MCP client: _"Read test/plans/whatsapp.md and execute the test plan."_

Each plan includes: bundle ID, preconditions, navigation map (top-level app structure so the agent doesn't waste time exploring), scenarios with steps and verify assertions, edge cases (popups, session expiry, slow network).

---

## Verified flows

### Core ADB flows

| Flow | Steps | Result |
|------|-------|--------|
| **Open app, read screen** | `launch('com.android.settings')` -> `snapshot()` | Clean YAML with refs on every tappable element |
| **Search by typing** | `tap(searchRef)` -> `type(inputRef, 'wifi')` -> `snapshot()` | TextInput shows `"wifi"`, results list appears |
| **Navigate back** | `press('back')` or `back()` | Returns to previous screen |
| **Scroll long lists** | `scroll(listRef, 'down')` -> `snapshot()` | New items visible |
| **Send a text message** | Messages -> Start chat -> type number -> tap suggestion -> type message -> tap send | Full multi-step flow, message sent |
| **Insert emoji** | Tap emoji button -> tap emoji -> inserted in TextInput | Agent reads emoji names from contentDesc |
| **Dismiss dialogs** | Dialog appears in tree with buttons -> `tap(okRef)` | Agent reads dialog text, decides, taps |
| **Screenshot capture** | `screenshot()` | PNG buffer, correct magic bytes |
| **Toggle Bluetooth** | Settings -> tap switch | Toggle states: `[checked]`, `[disabled]` transitional, settled |
| **Tap by coordinates** | `tapXY(540, 1200)` | Vision fallback, no ref needed |
| **Tap by grid cell** | `tapGrid('E10')` | Grid resolves cell to center coordinates |

### Termux ADB flows

All Core ADB flows apply identically -- same `adb.js`, different serial (`localhost:PORT`).

| Flow | Steps | Result |
|------|-------|--------|
| **Localhost ADB connection** | `adb tcpip` -> `adb forward` -> `adb connect localhost:PORT` -> `connect({termux: true})` | Device detected |
| **Snapshot via localhost** | `snapshot()` through localhost ADB | Same YAML output as USB ADB |

### Termux:API flows

| Flow | Steps | Result |
|------|-------|--------|
| **Battery status** | `batteryStatus()` | JSON with percentage, status, temperature |
| **Clipboard round-trip** | `clipboardSet('test')` -> `clipboardGet()` | Returns `"test"` |
| **Volume query** | `volumeGet()` | JSON array of stream volumes |
| **WiFi info** | `wifiInfo()` | JSON with SSID, BSSID, signal strength |

### iOS flows

Same page-object pattern as Android, verified on physical iPhone.

| Flow | Steps | Result |
|------|-------|--------|
| **Snapshot** | `connect()` -> `snapshot()` | Hierarchical YAML, same format as Android |
| **Navigate Settings** | `launch('com.apple.Preferences')` -> `tap(ref)` | Navigation works via coordinate tap |
| **Type in search** | `tap(searchRef)` -> `type(ref, 'wifi')` | Text entered via WDA keys |
| **Scroll** | `scroll(ref, 'down')` | Coordinate-based swipe within bounds |
| **Back navigation** | `back()` | Finds back button in refMap or swipe-from-left fallback |
| **Screenshot** | `screenshot()` | PNG via WDA /screenshot |

---

## What the agent handles

### ADB-based screen control (Core ADB + Termux ADB)

| Obstacle | How it's handled |
|----------|-----------------|
| **Bloated accessibility tree** | 4-step pruning: collapse wrappers, drop empty nodes, dedup repeats. Agent sees content, not structure. |
| **200+ Android widget classes** | 27 class->role mappings. Agent sees `Button`, not `androidx.appcompat.widget.AppCompatButton`. |
| **Text input broken on API 35+** | Word-by-word + KEYCODE_SPACE. Shell-escapes special characters. |
| **uiautomator dump broken on API 35+** | Dump to temp file, cat back via `exec-out`. |
| **Finding the right element** | Every interactive node gets `[ref=N]`. Agent picks ref, library resolves bounds. |
| **Multi-step forms** | Tap -> type -> tap next -> type -> submit. Fresh refs each snapshot. |
| **Confirmation dialogs** | Dialogs appear in tree with buttons. Agent reads and taps. |
| **Disabled/checked/selected state** | Rendered as `[disabled]`, `[checked]`, `[selected]`, `[focused]`. |
| **Scrollable content** | Scrollable containers get refs. `scroll(ref, 'down')` computes swipe within bounds. |
| **Context menus** | `longPress(ref)` triggers menu, appears in next snapshot. |
| **Binary output corruption** | `exec-out` for binary-safe stdout (screenshots, XML). |
| **Multi-device setups** | Every ADB call threads `-s serial`. |
| **ARIA tree fails** | `screenshot()` -> `tapXY(x, y)` or `tapGrid('C5')` as vision fallback. |
| **XML entities** | Parser decodes all 5 XML entities. Snapshots show `Network & internet`. |

### Termux ADB additional

| Obstacle | How it's handled |
|----------|-----------------|
| **Localhost device discovery** | `connect({termux: true})` auto-detects `localhost:PORT`. |
| **Wireless debugging pairing** | `adbPair()` and `adbConnect()` helpers. |

### Termux:API (direct Android APIs)

| Capability | How it's handled |
|------------|-----------------|
| **SMS send/receive** | `smsSend()` / `smsList()` -- no need to open Messages app |
| **Phone calls** | `call(number)` via telephony API |
| **Location** | `location({provider})` -- GPS/network/passive |
| **Camera** | `cameraPhoto(file, {camera})` -- front/back |
| **Clipboard** | `clipboardGet()` / `clipboardSet()` -- direct access |
| **Device info** | `batteryStatus()`, `volumeGet/Set()`, `wifiInfo()` |
| **Hardware** | `torch(on)`, `vibrate({duration})` |

### What still needs the agent's help

| Gap | Why | Workaround |
|-----|-----|------------|
| **Login / auth** | App tokens in hardware Keystore, can't extract | Agent logs in via UI |
| **WebView content** | uiautomator tree is empty/shallow inside WebViews | Phase 6: CDP bridge |
| **CAPTCHAs** | No programmatic bypass | Vision model or avoid |
| **Multi-touch** | `adb input` supports single point only | Phase 7: `sendevent` |
| **Screen control via Termux:API** | Not available -- direct API access only | Use Termux ADB mode alongside |

---

## Known limitations

| Limitation | Detail |
|------------|--------|
| **Snapshot latency** | uiautomator dump takes 1-5s depending on device. Emulators slower. |
| **WebView content** | Empty/shallow tree. Flutter can crash uiautomator with StackOverflowError. |
| **Auth/tokens** | Cannot read app tokens on non-rooted devices. |
| **Refs are unstable** | Ref numbers reset per snapshot. Never cache across snapshots. |
| **No parallel snapshots** | uiautomator dump is a global lock -- one at a time per device. |
| **Text input on API 35+** | `input text` with spaces broken. Word-by-word workaround implemented. |
| **No multi-touch** | Single-point gestures only via `adb shell input`. |
| **iOS WiFi tunnel** | WONTFIX on Linux -- requires Xcode WiFi pairing. USB required. |
| **iOS cert expiry** | Free Apple ID = 7-day cert. Must re-sign weekly. |

---

## Design decisions

| Decision | Rationale |
|----------|-----------|
| ADB direct, not Appium | No Java server, no driver install, no 500MB of deps. ADB is already there. |
| uiautomator, not AccessibilityService | Works without app modification. No helper APK needed. |
| Zero dependencies | Same philosophy as barebrowse. `child_process.execFile` is enough. |
| YAML-like output, not JSON | Token-efficient, agents already know the format from barebrowse. |
| Refs reset per snapshot | Stable refs would require diffing/tracking -- complexity for minimal gain. |
| Word-by-word typing | API 35+ broke `input text` with spaces. Only reliable method. |
| dump-to-file + cat | `uiautomator dump /dev/tty` broken on API 35+. |
| `exec-out` not `shell` | `adb shell` mangles `\r\n`. `exec-out` gives raw binary-safe stdout. |
| Page object pattern | Same API shape as barebrowse. Agents learn one pattern. |
| WDA over BLE HID for iOS | Real element tree + native click. No Bluetooth adapter, no Python at runtime. BLE HID had flat tree, unreliable mouse, screenshot blackout. |
| Node.js usbmux over pymobiledevice3 forwarder | pymobiledevice3 forwarder crashed with socket cleanup race. Node.js proxy: zero crashes. |

---

## Roadmap

### Completed

| Phase | Summary |
|-------|---------|
| 1.0 | Core library -- connect, snapshot, tap/type/press/swipe/scroll (6 modules, 36 tests) |
| 1.5 | Vision fallback -- tapXY, tapGrid, buildGrid, screenSize, XML entity decoding |
| 1.6 | Waiting + intents -- waitForText, waitForState, page.intent() |
| 2.0 | Termux ADB -- on-device control via localhost ADB |
| 2.5 | Termux:API -- SMS, calls, location, camera, clipboard (16 functions) |
| 2.7 | iOS pymobiledevice3 spike -- proved Linux -> iPhone control over USB |
| 2.8 | iOS BLE HID spike -- proved BLE keyboard/mouse input. Superseded by WDA in Phase 3.0. |
| 2.9-2.95 | iOS BLE HID + pymobiledevice3 module. Superseded by WDA in Phase 3.0. |
| 3.0 | iOS WDA rewrite -- replaced BLE HID with WDA over HTTP. Zero Python at runtime. |
| 3.1 | iOS translation layer -- translateWda() + shared prune/format pipeline |
| 3.2 | iOS usbmux.js + auto-connect -- replaced pymobiledevice3 forwarder |
| 3.3 | iOS CLI + MCP integration -- dual-platform MCP, setup wizard, cert tracking |
| 3.4 | iOS navigation fixes -- W3C Actions tap, screen-size-aware back(), launch error checking |
| 3.5 | iOS snapshot cleanup + auto-restart -- keyboard/Unicode/path stripping, internal name filter, findByText, WDA auto-restart (tier-1: stored RSD, ~3s, no pkexec; tier-2: full tunnel restart) |
| 3.6 | iOS custom-UI refs + scale factor -- `accessible` attr for Telegram-style apps, Retina `scaleFactor` + `screenshotToPoint()` |
| 3 | MCP server -- 11 tools, JSON-RPC 2.0 over stdio |
| 4 | CLI session mode -- daemon, logcat, full command set |

### Future

**Phase 5: bareagent adapter** -- `createMobileTools(opts)` -> `{tools, close}` for [bareagent](https://www.npmjs.com/package/bare-agent). Auto-detects environment (host ADB, Termux ADB, Termux:API). ~15 UI tools + ~10 API tools. Action tools auto-return snapshot after 300ms settle.

**Phase 6: WebView CDP bridge** -- Attach via CDP to debug-enabled WebViews. Native parts via uiautomator, WebView parts via barebrowse ARIA pipeline. Unified snapshot.

**Phase 7: Advanced interactions** -- `pinch(ref, scale)` via `sendevent` multi-touch, `drag(fromRef, toRef)`, `clipboard(text)` via `am broadcast`, notification shade interaction.

**Phase 8: Multi-device** -- Parallel sessions, device farm support (USB hub or cloud emulators).

---

## Comparison with alternatives

| | baremobile | DroidRun | Appium | agent-device |
|---|---|---|---|---|
| **Approach** | ADB + uiautomator direct | A11y tree + ADB | WebDriver + UiAutomator2 | A11y tree |
| **Dependencies** | 0 | Python + many | Java server + heavy client | TypeScript + deps |
| **Setup** | `npm install` + ADB | pip install + configs | Appium server + driver | npm install + build |
| **Snapshot format** | Pruned YAML with refs | Structured tree | PageSource XML | Structured tree |
| **Agent-ready** | Yes -- same format as barebrowse | Yes | No -- raw XML | Yes |
| **Lines of code** | ~1,400 | ~5,000+ | Massive | Growing |
| **Philosophy** | Minimal, zero deps, vanilla JS | AI-native, funded startup | Enterprise test framework | Multi-platform |

---

## References

- [barebrowse](https://github.com/hamr0/barebrowse) -- sister project for web browsing
- [Android uiautomator](https://developer.android.com/training/testing/other-components/ui-automator)
- [ADB documentation](https://developer.android.com/tools/adb)
- [DroidRun](https://github.com/droidrun/droidrun) -- Python-based Android agent framework
- [agent-device](https://github.com/callstackincubator/agent-device) -- TypeScript multi-platform
- [bareagent](https://www.npmjs.com/package/bare-agent) -- LLM agent loop library
- [WebDriverAgent](https://github.com/appium/WebDriverAgent) -- WDA for iOS automation
