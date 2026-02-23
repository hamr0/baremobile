```
  ┌─────────────┐
  │ ■  Settings  │
  │ ─────────── │
  │ ◉ Wi-Fi     │
  │ ◉ Bluetooth │
  │ ▸ Display   │
  └─────────────┘

  baremobile
```

> Your agent controls Android like you do -- same device, same apps, same screen.
> Prunes snapshots down to what matters. Clean YAML, zero wasted tokens.

---

## What this is

baremobile gives your AI agent control of any Android device. Take a snapshot, get a pruned accessibility tree with `[ref=N]` markers. Tap, type, swipe by ref. Move on.

It uses ADB directly -- `adb` on PATH, device connected, done. No Appium. No Java server. Zero dependencies.

Same patterns as [barebrowse](https://www.npmjs.com/package/barebrowse). Agents learn one API, use it for web and mobile.

## Install

```
npm install baremobile
```

Requires Node.js >= 22 and `adb` in PATH (from [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools)).

## Quick start

```js
import { connect } from 'baremobile';

const page = await connect();          // auto-detect device
console.log(await page.snapshot());    // pruned YAML with refs

await page.tap(5);                     // tap element by ref
await page.type(3, 'hello world');     // type into input
await page.press('back');              // navigate back
await page.launch('com.android.settings');  // open app

const png = await page.screenshot();   // PNG buffer
page.close();
```

## What the agent sees

```
- ScrollView [ref=1]
  - Group
    - Text "Settings"
    - Group [ref=2]
      - Text "Search settings"
  - ScrollView [ref=3]
    - List
      - Group [ref=4]
        - Text "Network & internet"
        - Text "Mobile, Wi-Fi, hotspot"
      - Group [ref=5]
        - Text "Connected devices"
        - Text "Bluetooth, pairing"
      - Group [ref=6]
        - Text "Apps"
        - Text "Default apps, app management"
```

Compact, token-efficient. Interactive elements get `[ref=N]` markers. Agent reads the snapshot, picks a ref, acts on it.

## API

### `connect(opts) → page`

Connect to an ADB device. Returns a page object.

| Option | Default | Description |
|--------|---------|-------------|
| `device` | `'auto'` | Device serial string, or `'auto'` for first available |

### `snapshot(opts) → string`

One-shot: dump + parse + prune + format. No session state.

### Page methods

| Method | Description |
|--------|-------------|
| `page.snapshot()` | Accessibility tree → pruned YAML string |
| `page.tap(ref)` | Tap element by ref |
| `page.type(ref, text)` | Type text into element |
| `page.press(key)` | Press key: back, home, enter, delete, tab, escape, arrows, space, power, volup, voldown, recent |
| `page.swipe(x1, y1, x2, y2, duration)` | Raw swipe between points |
| `page.scroll(ref, direction)` | Scroll within element (up/down/left/right) |
| `page.longPress(ref)` | Long press element |
| `page.back()` | Press back button |
| `page.home()` | Press home button |
| `page.launch(pkg)` | Launch app by package name |
| `page.screenshot()` | Screen capture → PNG Buffer |
| `page.close()` | End session |

## How it works

```
connect() → resolve device serial
snapshot() → adb uiautomator dump → XML
           → regex XML parser → node tree
           → 4-step pruning pipeline → pruned tree + refMap
           → YAML formatter → agent-ready string
tap(ref)   → refMap lookup → bounds center → adb input tap X Y
```

6 modules, ~500 lines, zero dependencies.

## What it handles

| Challenge | How |
|-----------|-----|
| **Snapshot extraction** | uiautomator dump to temp file + cat (API 35+ compatible) |
| **Tree pruning** | Collapse wrappers, drop empties, dedup repeated items |
| **27 widget classes** | Mapped to short roles: Button, Text, TextInput, Image, List, etc. |
| **Text input on API 35+** | Word-by-word + KEYCODE_SPACE (broken `input text` workaround) |
| **Shell escaping** | Special characters properly escaped for adb shell |
| **Binary-safe output** | `exec-out` for screenshots and XML (not `shell` which mangles bytes) |
| **Multi-device** | Serial threading on every ADB call |

## Requirements

- Node.js >= 22
- `adb` in PATH
- ADB-connected Android device or emulator

## Coming soon

MCP server, CLI session mode, bareagent adapter, WebView CDP bridge. See [docs/blueprint.md](docs/blueprint.md) for the full roadmap.

## License

MIT
