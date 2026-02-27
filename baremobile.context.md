# baremobile — Agent Integration Guide

Use this file as context when building agents that control Android devices via baremobile.

## Core Loop

Every agent interaction follows observe-think-act:

```js
import { connect } from 'baremobile';

const page = await connect();    // auto-detect device
let snapshot = await page.snapshot();  // observe

// Agent reads snapshot, picks action
await page.tap(5);               // act
snapshot = await page.snapshot(); // observe again
```

Always snapshot after every action. Refs reset per snapshot — never cache them.

## Snapshot Format

```
- ScrollView [ref=1]
  - Group
    - Text "Settings"
    - Group [ref=2]
      - Text "Search settings"
  - List
    - Group [ref=3]
      - Text "Wi-Fi"
      - Switch [ref=4] (Wi-Fi) [checked]
    - Group [ref=5] [disabled]
      - Text "Airplane mode"
```

**What to read:**
- `[ref=N]` — interactive element, use with tap/type/scroll
- `"quoted text"` — visible text on screen
- `(parenthesized)` — contentDesc / accessibility label
- `[checked]`, `[selected]`, `[focused]`, `[disabled]` — element state
- Indentation = nesting (parent-child)

**Roles:** Text, TextInput, Button, Image, ImageButton, CheckBox, Switch, Radio, Toggle, Slider, Progress, Select, List, ScrollView, Group, TabList, Tab. Unknown classes show their short Java class name.

## Page Methods

### Navigation
```js
await page.launch('com.android.settings');  // open app by package
await page.intent('android.settings.BLUETOOTH_SETTINGS');  // deep nav via intent
await page.back();                          // press back
await page.home();                          // press home
await page.press('recent');                 // app switcher
```

### Reading
```js
const yaml = await page.snapshot();    // pruned YAML with refs
const png = await page.screenshot();   // PNG buffer
```

### Interaction
```js
await page.tap(ref);                        // tap element
await page.tapXY(540, 1200);               // tap by pixel coordinates
await page.tapGrid('C5');                  // tap by grid cell
await page.type(ref, 'text');               // type into field
await page.type(ref, 'new', {clear: true}); // clear field first, then type
await page.press('enter');                  // press key
await page.scroll(ref, 'down');             // scroll within element
await page.longPress(ref);                  // long press
await page.swipe(x1, y1, x2, y2, 300);     // raw swipe
```

### Waiting
```js
const snap = await page.waitForText('Bluetooth', 10000);  // poll until text appears
const snap = await page.waitForState(3, 'checked', 10000); // poll until state matches
// States: 'enabled', 'disabled', 'checked', 'unchecked', 'focused', 'selected'
```

### Keys for press()
back, home, enter, delete, tab, escape, up, down, left, right, space, power, volup, voldown, recent

## Common Patterns

### Type into a field
```
Snapshot shows:  TextInput [ref=3] "Search settings" [focused]
```
- If `[focused]` — just type, no extra tap needed: `page.type(3, 'wifi')`
- If not focused — `page.type(3, 'wifi')` will tap first automatically
- To replace existing text: `page.type(3, 'new text', {clear: true})`

### Navigate a list
```
Snapshot shows:  ScrollView [ref=1] → List → Group [ref=2] "Wi-Fi" ...
```
- Tap an item: `page.tap(2)`
- Scroll for more: `page.scroll(1, 'down')` then snapshot again
- Items at the bottom may not be visible — scroll and re-snapshot

### Handle a dialog
```
Snapshot shows:  Text "Allow access?" → Button [ref=5] "Allow" → Button [ref=6] "Deny"
```
- Read dialog text, decide, tap the appropriate button
- Dialogs always have their buttons in the snapshot with refs

### Open an app
```js
await page.launch('com.android.settings');
await new Promise(r => setTimeout(r, 2000)); // wait for app to load
const snapshot = await page.snapshot();
```
Common packages: `com.android.settings`, `com.android.chrome`, `com.google.android.apps.messaging`, `com.google.android.dialer`, `com.android.contacts`

### Deep navigation with intents
```js
await page.intent('android.settings.BLUETOOTH_SETTINGS');
await page.intent('android.settings.WIFI_SETTINGS');
await page.intent('android.settings.DISPLAY_SETTINGS');
await page.intent('android.settings.SOUND_SETTINGS');
await page.intent('android.settings.LOCATION_SOURCE_SETTINGS');
await page.intent('android.settings.AIRPLANE_MODE_SETTINGS');
await page.intent('android.settings.APPLICATION_SETTINGS');
// With extras:
await page.intent('android.intent.action.VIEW', { url: 'https://example.com' });
```
Skip multi-step navigation when you know the intent action.

### Vision fallback (when ARIA tree fails)
```js
const png = await page.screenshot();    // get visual
const grid = await page.grid();         // get grid info
console.log(grid.text);                 // "Screen: 1080×2400, Grid: 10 cols (A-J) × 22 rows..."
// Send screenshot + grid.text to vision model
// Model responds: "tap C5"
await page.tapGrid('C5');               // or page.tapXY(x, y)
```
Use when: Flutter apps crash uiautomator, WebView content invisible, snapshot seems wrong.

### Send a message (multi-step)
1. `launch('com.google.android.apps.messaging')`
2. Snapshot → find "Start chat" button → `tap(ref)`
3. Snapshot → find TextInput for "To:" → `type(ref, '5551234567')`
4. Snapshot → find suggestion like "Send to (555) 123-4567" → `tap(ref)`
5. Snapshot → find compose TextInput → `type(ref, 'Hello!')`
6. Snapshot → find "Send SMS" button → `tap(ref)`

Each step: snapshot, read, decide, act. The agent adapts to whatever the UI shows.

### Pick an emoji
1. In compose view, find emoji button (contentDesc contains "emoji") → `tap(ref)`
2. Snapshot → emoji grid appears, each emoji is `View [ref=N] (😀)` with name in contentDesc
3. Tap the emoji ref → it inserts into the TextInput
4. Press back or tap outside to close emoji panel

### Attach a file
1. Find attach/`+` button (contentDesc "Show attach" or "Show more options") → `tap(ref)`
2. Snapshot → options appear: Gallery, Files, Location, etc. → `tap(ref)` for Files
3. System file picker opens → snapshot shows folders and files with refs
4. Navigate to file → `tap(ref)` to select

### Unlock the screen
```js
await page.press('power');           // wake
await page.swipe(540, 1800, 540, 800, 300);  // swipe up
await page.type(ref, '1234');        // PIN (if needed)
await page.press('enter');
```

## Gotchas

### Core ADB + Termux ADB (screen control)

**Refs reset every snapshot.** Never store a ref and use it after another snapshot. Always re-read.

**Snapshot takes 1-5 seconds.** uiautomator dump is slow, especially on emulators. Don't snapshot in a tight loop.

**Wait after actions.** UI needs time to settle. Wait 500ms-2s after taps, 2-3s after launching apps.

**Some list items aren't clickable.** Android file picker drawer items, some system UI elements don't have `clickable=true` so they don't get refs. Use raw `swipe()` to coordinates as fallback.

**WebView content is invisible.** uiautomator can't see inside WebViews. If the snapshot looks empty/shallow in a browser or hybrid app, that's why. Future: CDP bridge.

**Switch/toggle may disappear when off.** Android sometimes removes unchecked Switch/Toggle elements from the accessibility tree. On the Bluetooth page, when BT is off the Switch disappears — only `Text "Use Bluetooth"` remains. No switch present = off. Don't look for `Switch [unchecked]`.

**Toggles have transitional states.** After tapping a system toggle (Bluetooth, WiFi), it briefly shows `[disabled]` while the hardware state changes. Use `waitForText()` or `waitForState()` instead of fixed delays to confirm the action completed.

**HTML entities in text.** Decoded at parse time. `&amp;` → `&`, `&lt;` → `<`, etc. Snapshots show clean text.

**Emojis show as entities in contentDesc.** `View [ref=8] (&#128512;)` means the emoji 😀. The agent can read the unicode codepoint or just tap by ref position in the grid.

**type() is word-by-word.** On API 35+, `adb input text` is broken for spaces. baremobile splits text into words and injects KEYCODE_SPACE between them. This means typing is slower for long strings.

### Termux ADB only

**Wireless debugging drops on reboot.** Must re-enable in Developer Options and re-pair after every device restart. The connection is not persistent.

**Pairing port differs from connect port.** The port shown when tapping "Pair device with pairing code" is NOT the port for `adb connect`. The connect port is shown on the main Wireless debugging screen.

### Termux:API only

**No screen control.** Termux:API cannot read the screen, take snapshots, or tap elements. It provides direct Android API access only (SMS, calls, location, etc.). Use Termux ADB for screen control.

**Commands are blocking.** `termux-*` commands run synchronously. `location()` can take several seconds waiting for a GPS fix. `cameraPhoto()` blocks until capture completes.

**Some commands need a real device.** `smsSend()`, `call()`, `location()` require hardware (SIM card, GPS) that emulators don't have. `batteryStatus()`, `clipboardGet/Set()`, `volumeGet()`, `wifiInfo()`, `vibrate()` work on emulators.

**Termux:API addon must be installed separately.** The `termux-api` package (CLI tools) AND the Termux:API Android app (F-Droid) are both required. Missing the app causes silent failures.

## Termux Setup (on-device control)

baremobile can run inside [Termux](https://termux.dev/) on the phone itself — no USB, no host machine.

### Termux + ADB (full screen control)
```bash
# In Termux:
pkg install android-tools nodejs-lts

# On the phone: Settings → Developer options → Wireless debugging → ON
# Tap "Pair device with pairing code" — note the port + code
adb pair localhost:PORT CODE

# Note the connect port (shown on Wireless debugging screen, different from pairing port)
adb connect localhost:PORT

# Verify
adb devices  # should show localhost:PORT  device
```

Then in Node.js:
```js
import { connect } from 'baremobile';
const page = await connect({ termux: true });  // or auto-detects
const snap = await page.snapshot();
```

**Limitations:** Wireless debugging must be re-enabled after every reboot. The pairing code is one-time but the connection drops on reboot.

### Termux:API (direct Android APIs, no ADB)
Install Termux:API addon from F-Droid, then:
```bash
pkg install termux-api
```

```js
import * as api from 'baremobile/src/termux-api.js';

// Check availability
if (await api.isAvailable()) {
  await api.smsSend('5551234', 'Hello from baremobile!');
  const inbox = await api.smsList({ limit: 5, type: 'inbox' });
  await api.call('5551234');
  const loc = await api.location({ provider: 'network' });
  const battery = await api.batteryStatus();
  await api.clipboardSet('copied text');
  const text = await api.clipboardGet();
  await api.notify('Agent', 'Task complete', { sound: true });
  await api.torch(true);  // flashlight on
  await api.vibrate({ duration: 500 });
}
```

Termux:API is **not** screen control — it's direct Android API access. Use it for SMS, calls, location, camera, clipboard. Faster and more reliable than tapping through the UI.

### Three levels of control

| Level | ADB? | Screen? | Example |
|-------|------|---------|---------|
| **Termux:API** | No | No | "Send a text", "what's my battery" |
| **ADB (from host)** | USB/WiFi | Yes | QA testing, development |
| **ADB (from Termux)** | localhost | Yes | Autonomous agent on phone |

## Device Setup (ADB from host)

```bash
# Check device connected
adb devices

# Start emulator (if using Android Studio)
emulator -avd Pixel_8_API_35 -no-window  # headless

# Install an app
adb install path/to/app.apk

# Forward port (for future WebView CDP)
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

## iOS (WDA-based — same pattern as Android)

baremobile controls iPhones via WebDriverAgent (WDA) over HTTP. Same `snapshot()` → `tap(ref)` pattern as Android — hierarchical accessibility tree with `[ref=N]` markers, coordinate-based tap, type, scroll, screenshots. Translation layer converts WDA XML into Android node shape, then shared `prune()` + `formatTree()` pipeline produces identical YAML output.

### Architecture

```
WDA XML  →  translateWda()  →  node tree  →  prune()  →  formatTree()  →  YAML
                                                          (shared with Android)
```

Setup uses pymobiledevice3 (Python 3.12) for tunnel + DDI mount + WDA launch. Port forwarding handled by Node.js usbmux client (`src/usbmux.js`, replaces flaky pymobiledevice3 forwarder). Zero Python at runtime. `connect()` auto-discovers WDA via cached WiFi > USB proxy > localhost.

### Quick start

```js
import { connect } from 'baremobile/src/ios.js';

const page = await connect();
console.log(await page.snapshot());   // hierarchical YAML with [ref=N] markers
await page.tap(1);                    // coordinate tap via bounds center
await page.type(2, 'hello');          // coordinate tap to focus + WDA keys
await page.launch('com.apple.Preferences');
await page.back();                    // find back button in refMap or swipe-from-left
await page.screenshot();              // PNG buffer
page.close();
```

### iOS Page Methods

| Method | What it does |
|--------|-------------|
| `page.snapshot()` | WDA `/source` → `translateWda()` → `prune()` → `formatTree()` → hierarchical YAML |
| `page.tap(ref)` | Coordinate tap at bounds center (x, y) |
| `page.type(ref, text, opts)` | Coordinate tap to focus → WDA keys. `{clear: true}` to clear first |
| `page.scroll(ref, direction)` | Coordinate-based swipe within element bounds (up/down/left/right) |
| `page.swipe(x1, y1, x2, y2, duration)` | Raw swipe between coordinates |
| `page.longPress(ref)` | W3C pointer action at bounds center with 1s pause |
| `page.tapXY(x, y)` | Tap by pixel coordinates (vision fallback) |
| `page.back()` | Search refMap for back button, fallback to swipe-from-left-edge |
| `page.home()` | WDA `/wda/homescreen` |
| `page.launch(bundleId)` | Launch app by bundle ID |
| `page.screenshot()` | WDA `/screenshot` → PNG buffer |
| `page.waitForText(text, timeout)` | Poll snapshot until text appears |
| `page.press(key)` | Hardware buttons: `home`, `volumeup`, `volumedown` |
| `page.unlock(passcode)` | Unlock device with passcode. Throws if passcode required but not provided, or wrong passcode. |
| `page.close()` | Close the connection and clean up resources |

### Key differences from Android
- **Bundle IDs, not package names** — `com.apple.Preferences` not `com.android.settings`
- **No intents** — use `page.launch(bundleId)` for app navigation
- **No grid/tapGrid** — coordinate tap from bounds is reliable
- **Back is semantic** — searches refMap for back button, falls back to swipe gesture
- **Same hierarchical YAML** — shared `prune()` + `formatTree()` pipeline, identical output format
- **press() is limited** — only `home`, `volumeup`, `volumedown`. Use `tap(ref)` for UI buttons.

### Requirements

| Requirement | Why |
|------------|-----|
| WDA on device | Signed with free Apple ID (7-day cert, re-sign weekly via AltServer-Linux) |
| pymobiledevice3 | Setup only — tunnel, DDI mount, WDA launch. Python 3.12. |
| USB cable (required) | WiFi tunnel requires Mac/Xcode for WiFi pairing — not possible on Linux |
| Developer Mode on iPhone | Required for developer services |

### Setup
```bash
# Interactive wizard (guides through all steps, cross-platform):
baremobile setup     # pick option 2 (from scratch) or 3 (start WDA server)
# When done:
baremobile ios teardown  # kill all bridge processes
```

#### iOS setup steps (option 2: from scratch)
1. Detect host OS (Linux/macOS/WSL + package manager)
2. Check pymobiledevice3 (with install guidance per OS)
3. Check AltServer (`.wda/AltServer`)
4. Check libdns_sd / mDNS
5. Check USB device (prompts to connect if missing)
6. Sign & install WDA via AltServer (Apple ID + 2FA, anisette fallback)
7. Device settings checklist:
   - [1] Developer Mode: Settings > Privacy & Security > Developer Mode > ON
   - [2] Trust profile: Settings > General > VPN & Device Management > Trust
   - [3] UI Automation: Settings > Developer > Enable UI Automation > ON
8. Start WDA server (tunnel + DDI mount + WDA launch + port forward)
9. Final verification (`/status` health check)

#### iOS setup steps (option 3: start WDA server only)
For when WDA is already installed and device settings are configured.
Steps: USB check → tunnel (pkexec) → DDI mount → WDA launch → port forward → verify

#### Prerequisites
| Requirement | Install |
|-------------|---------|
| pymobiledevice3 | `pip install --user pymobiledevice3` |
| AltServer-Linux | Download from GitHub, place at `.wda/AltServer` |
| WebDriverAgent.ipa | Place at `.wda/WebDriverAgent.ipa` |
| libdns_sd | `dnf install avahi-compat-libdns_sd-devel` (Fedora) / `apt install libavahi-compat-libdnssd-dev` (Ubuntu) |
| Apple ID | Free account works (7-day cert, re-sign weekly via `baremobile ios resign`) |

#### Environment variables
| Variable | Purpose |
|----------|---------|
| `ALTSERVER_ANISETTE_SERVER` | Override anisette server URL (fallback: `ani.sidestore.io`) |

## MCP Server Integration

baremobile includes an MCP server (`mcp-server.js`) for Claude Code and other MCP clients.

### Setup
```bash
# Add to Claude Code
claude mcp add baremobile -- node /path/to/baremobile/mcp-server.js

# Or use .mcp.json in the project root (auto-detected)
```

### Tools (10, dual-platform)

All tools accept optional `platform: "android" | "ios"` (default: android). Both platforms can be used in the same session.

| Tool | Params | Returns |
|------|--------|---------|
| `snapshot` | `maxChars?`, `platform?` | YAML tree (or file path if >30K chars) |
| `tap` | `ref`, `platform?` | `'ok'` |
| `type` | `ref`, `text`, `clear?`, `platform?` | `'ok'` |
| `press` | `key`, `platform?` | `'ok'` |
| `scroll` | `ref`, `direction`, `platform?` | `'ok'` |
| `swipe` | `x1`, `y1`, `x2`, `y2`, `duration?`, `platform?` | `'ok'` |
| `long_press` | `ref`, `platform?` | `'ok'` |
| `launch` | `pkg`, `platform?` | `'ok'` |
| `screenshot` | `platform?` | base64 PNG (image content type) |
| `back` | `platform?` | `'ok'` |

iOS cert warning: if WDA cert is >6 days old or missing, warning is prepended to the first iOS snapshot.

### Convention
Action tools return `'ok'` — call `snapshot` to observe the result. This matches the barebrowse MCP pattern.

### Output artifacts
Large snapshots saved to `.baremobile/screen-{timestamp}.yml` when exceeding `maxChars` (default 30,000).

## CLI Session Mode

baremobile includes a CLI for session-based control — start a daemon, issue commands, inspect output files. Useful for shell scripting, Claude Code integration, and JSONL-consumable automation.

### Session lifecycle
```bash
baremobile open [--device=SERIAL] [--platform=android|ios]
                                     # start daemon, writes session.json
baremobile status                    # check if session is alive
baremobile close                     # shut down daemon, clean up
```

### Setup & iOS management
```bash
baremobile setup                     # interactive setup wizard (Android or iOS)
baremobile ios resign                # re-sign WDA cert (7-day Apple free cert)
baremobile ios teardown              # kill iOS tunnel/WDA processes
```

### Commands
```bash
# Screen
baremobile snapshot                  # -> .baremobile/screen-*.yml
baremobile screenshot                # -> .baremobile/screenshot-*.png
baremobile grid                      # screen grid info (for vision fallback)

# Interaction
baremobile tap <ref>                 # tap element by ref
baremobile tap-xy <x> <y>          # tap by pixel coordinates
baremobile tap-grid <cell>         # tap by grid cell (e.g. C5)
baremobile type <ref> <text> [--clear]
baremobile press <key>              # back, home, enter, ...
baremobile scroll <ref> <direction> # up/down/left/right
baremobile swipe <x1> <y1> <x2> <y2> [--duration=N]
baremobile long-press <ref>
baremobile launch <pkg>
baremobile intent <action> [--extra-string key=val ...]
baremobile back
baremobile home

# Waiting
baremobile wait-text <text> [--timeout=N]
baremobile wait-state <ref> <state> [--timeout=N]

# Logging
baremobile logcat [--filter=TAG] [--clear]
```

### Output conventions
All output goes to `.baremobile/` in the current directory:
- `session.json` — daemon port + pid
- `screen-TIMESTAMP.yml` — snapshots
- `screenshot-TIMESTAMP.png` — screenshots
- `logcat-TIMESTAMP.json` — logcat entries

### Agent usage
```bash
# Start session, take snapshot, act, observe
baremobile open
baremobile launch com.android.settings
sleep 2
baremobile snapshot    # prints file path to stdout
baremobile tap 4
baremobile snapshot
baremobile close
```

Action commands print `ok` on success. File-producing commands print the file path. Errors go to stderr with non-zero exit.

### JSON mode (`--json`)

Add `--json` to any command for machine-readable output — one JSON line per command:

```bash
baremobile open --json       # {"ok":true,"pid":1234,"port":40049,"outputDir":"/path/.baremobile"}
baremobile snapshot --json   # {"ok":true,"file":"/path/.baremobile/screen-2026-02-24T19-41-01.yml"}
baremobile tap 4 --json      # {"ok":true}
baremobile logcat --json     # {"ok":true,"file":"/path/.baremobile/logcat-*.json","count":523}
baremobile status --json     # {"ok":true,"pid":1234,"port":40049,"startedAt":"2026-02-24T19:40:45Z"}
# errors:
baremobile status --json     # {"ok":false,"error":"No session found."}
```

Every response has `ok: true|false`. File-producing commands include `file`. Errors include `error`. Parse one line per invocation.

## Error Recovery

If an action doesn't seem to work:
1. **waitForText** — use `waitForText('expected text', 5000)` instead of guessing delays
2. **Snapshot again** — the UI may have changed during the action
3. **Screenshot + vision** — `screenshot()` + `grid()` if the ARIA tree looks wrong
4. **Press back** — if stuck in an unexpected state, back out and retry
5. **Home + relaunch** — nuclear option to reset to known state
