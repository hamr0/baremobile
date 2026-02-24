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
| `page.tapXY(x, y)` | Tap by pixel coordinates (vision fallback) |
| `page.tapGrid(cell)` | Tap by grid cell, e.g. `"C5"` |
| `page.grid()` | Get grid info: `{cols, rows, cellW, cellH, resolve, text}` |
| `page.back()` | Press back button |
| `page.home()` | Press home button |
| `page.launch(pkg)` | Launch app by package name |
| `page.screenshot()` | Screen capture → PNG Buffer |
| `page.intent(action, extras?)` | Deep navigation via Android intent |
| `page.waitForText(text, timeout)` | Poll snapshot until text appears |
| `page.waitForState(ref, state, timeout)` | Poll for element state (checked, enabled, focused...) |
| `page.close()` | End session |

### Connect options

| Option | Default | Description |
|--------|---------|-------------|
| `device` | `'auto'` | Device serial string, or `'auto'` for first available |
| `termux` | `false` | Set `true` to use localhost ADB (for Termux on-device use) |

## How it works

```
connect() → resolve device serial (USB, WiFi, or Termux localhost)
snapshot() → adb uiautomator dump → XML
           → regex XML parser → node tree
           → 4-step pruning pipeline → pruned tree + refMap
           → YAML formatter → agent-ready string
tap(ref)   → refMap lookup → bounds center → adb input tap X Y
```

8 modules, ~800 lines, zero dependencies.

## What it handles automatically

This is the obstacle course your agent doesn't have to think about:

| Obstacle | How it's handled |
|----------|-----------------|
| **Bloated accessibility tree** | 4-step pruning pipeline: collapse layout wrappers, drop empty nodes, dedup RecyclerView/ListView repeats. Only meaningful content survives. |
| **200+ Android widget classes** | 27 class→role mappings (Button, Text, TextInput, Image, List, etc.). Unknown classes → last segment of fully-qualified name. Agent sees roles, not Java packages. |
| **Text input broken on API 35+** | `input text` with spaces doesn't work. Workaround: word-by-word input with KEYCODE_SPACE injected between words. Handles `& \| ; $ \` " ' \ < > ( )` via shell escaping. |
| **uiautomator dump fails on API 35+** | `dump /dev/tty` broken. Dumps to temp file on device, cats it back via `exec-out` (binary-safe, no line ending mangling). |
| **Tap the right thing** | Every interactive element (clickable/editable/scrollable) gets a `[ref=N]` marker. Agent says `tap(5)`, library resolves ref → bounds center → `input tap X Y`. |
| **Type into the right field** | `type(ref, text)` taps to focus first, waits 500ms for keyboard, then inputs. Agent doesn't calculate coordinates. |
| **Navigate between screens** | `back()`, `home()`, `press('recent')`. Agent navigates like a human — back button, home, app switcher. |
| **Launch any app** | `launch('com.android.settings')` — fires launcher intent via `am start`. No need to find app icon on home screen. |
| **Scroll long lists** | `scroll(ref, 'down')` computes swipe within the scrollable element's bounds. Works for vertical and horizontal scrolling. |
| **Long press for context menus** | `longPress(ref)` — zero-distance swipe with 1000ms duration. Triggers long-press handlers reliably. |
| **Multi-device setups** | Every ADB call threads `-s serial`. `connect({device: 'emulator-5554'})` targets a specific device. Default: auto-detect first available. |
| **Binary output corruption** | Screenshots use `exec-out` (raw stdout) not `shell` (which mangles `\r\n`). PNG bytes arrive intact. |
| **Disabled/checked/focused states** | Rendered in snapshot as `[disabled]`, `[checked]`, `[focused]`, `[selected]`. Agent sees widget state without extra API calls. |
| **ARIA tree fails (vision fallback)** | `screenshot()` → send to vision model → `tapXY(x, y)` or `tapGrid('C5')`. Grid: 10 cols (A-J), auto-sized rows for roughly square cells. Covers Flutter crashes, empty WebViews, obfuscated views. |
| **XML entities in text** | uiautomator dumps `&amp;`, `&lt;` etc. Parser decodes at parse time. Snapshots show clean `Network & internet`. |
| **Sending messages** | Full multi-step flow verified: open Messages → start chat → type recipient → tap suggestion → type message → tap "Send SMS". End-to-end on emulator. |
| **Emoji insertion** | Tap emoji button → panel opens with tappable emojis (each `View [ref=N]` with name in contentDesc) → tap → inserted into TextInput. Agent picks emojis by name. |
| **File attachment** | Tap attach → Files → system file picker opens → navigate folders → tap file → attached. Agent navigates the picker like any other screen. |
| **Dialogs and confirmations** | Appear in snapshot with text + buttons with refs. Agent reads dialog, taps OK / Cancel / Allow. |

## What still needs the agent's help

| Gap | Why | Workaround |
|-----|-----|------------|
| **Login / auth** | App tokens live in Keystore (hardware-bound) or locked SharedPrefs. Can't extract them. | Agent logs in via UI — tap username field, type credentials, tap sign in. Works fine. |
| **WebView content** | uiautomator tree is empty/shallow inside WebViews. Flutter apps can crash uiautomator. | Roadmap: CDP bridge for debug-enabled WebViews (Phase 5). |
| **CAPTCHAs** | No way around visual CAPTCHAs programmatically. | Agent + vision model, or skip sites that require them. |
| **Screen unlock** | uiautomator needs unlocked screen. | `press('power')` to wake, `swipe()` to dismiss, `type()` for PIN. Automatable. |
| **Multi-touch / pinch** | `adb input` only supports single-point gestures. | Roadmap: `sendevent` for multi-touch (Phase 6). |

## Device setup

### Android (one-time)

1. **Enable Developer Options** — Settings → About phone → tap "Build number" 7 times
2. **Enable USB debugging** — Settings → Developer options → toggle "USB debugging" on
3. **Connect device** — plug in USB cable, tap "Allow" on the USB debugging prompt
4. **Verify** — run `adb devices`, your device should show as `device` (not `unauthorized`)

For WiFi debugging (no cable): `adb tcpip 5555` while connected via USB, then `adb connect <device-ip>:5555`.

For emulators: no setup needed. `adb devices` shows them automatically.

### Requirements

- Node.js >= 22
- `adb` in PATH (from [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools))
- Android device or emulator with USB debugging enabled

## Termux (on-device control)

baremobile can run inside Termux on the phone itself — no USB, no host machine needed.

### Termux + ADB (full screen control)
```bash
# In Termux:
pkg install android-tools nodejs-lts
# Enable Wireless Debugging in Developer Options, pair + connect:
adb pair localhost:PORT CODE
adb connect localhost:PORT
```
```js
import { connect } from 'baremobile';
const page = await connect({ termux: true });  // auto-detects Termux env
```

### Termux:API (direct Android APIs, no ADB)
```bash
pkg install termux-api  # also install Termux:API addon app from F-Droid
```
```js
import * as api from 'baremobile/src/termux-api.js';
await api.smsSend('5551234', 'Hello!');      // send SMS
const battery = await api.batteryStatus();    // {percentage, status, ...}
await api.call('5551234');                    // make a call
const loc = await api.location();             // GPS coordinates
await api.clipboardSet('copied');             // set clipboard
```

16 functions: smsSend, smsList, call, location, cameraPhoto, clipboardGet/Set, contactList, notify, batteryStatus, volumeGet/Set, wifiInfo, torch, vibrate, isAvailable.

## Requirements

### ADB mode (from host machine)
- Node.js >= 22
- `adb` in PATH ([Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools))
- Android device/emulator with USB debugging enabled

### Termux + ADB mode (on-device)
- Android 11+ (wireless debugging support)
- [Termux](https://f-droid.org/packages/com.termux/) from F-Droid
- `pkg install android-tools nodejs-lts` in Termux
- Wireless debugging enabled in Developer Options (must re-enable after reboot)

### Termux:API mode (on-device, no ADB)
- [Termux](https://f-droid.org/packages/com.termux/) from F-Droid
- [Termux:API](https://f-droid.org/packages/com.termux.api/) addon from F-Droid
- `pkg install termux-api nodejs-lts` in Termux

## Coming soon

MCP server, CLI session mode, bareagent adapter, WebView CDP bridge. See [docs/blueprint.md](docs/blueprint.md) for the full roadmap.

## License

MIT
