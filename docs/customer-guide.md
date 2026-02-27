# baremobile — Customer Guide

> Control any phone from code. Android for all use cases, iOS for QA/testing.

---

## What is baremobile?

A vanilla JS library that gives AI agents (or any code) control of mobile devices. Same patterns as [barebrowse](https://www.npmjs.com/package/barebrowse) for web — agents learn one API, use it for both web and mobile.

No Appium. No Java server. No build step. Zero required dependencies.

---

## Modules at a Glance

| # | Module | Platform | Use case | What it does | Requirements |
|---|--------|----------|----------|-------------|--------------|
| 1 | **Core ADB** | Android | QA, automation | Full screen control — accessibility tree snapshots, tap/type/swipe by ref, screenshots, app lifecycle | `adb` in PATH, USB debugging enabled |
| 2 | **Termux ADB** | Android | QA, autonomous agents | Same full screen control, but runs on the phone itself — no host machine needed | Termux app, wireless debugging |
| 3 | **Termux:API** | Android | QA, autonomous agents | Direct Android APIs — SMS, calls, location, camera, clipboard, contacts, notifications. No screen control. | Termux + Termux:API app |
| 4 | **iOS (WebDriverAgent)** | iOS | QA/testing only | Same `snapshot()` → `tap(ref)` as Android. Real accessibility tree via WDA, native element click, type, scroll, screenshots. Pure HTTP at runtime. Auto-discovery: WiFi (cached) > USB (usbmux.js) > localhost. | WDA on device, USB cable (required), Python 3.12 (setup only) |

### How they relate

```
                        ┌─────────────────────────────────┐
                        │         Your Agent / Code        │
                        └──────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
     ┌────────▼────────┐  ┌───────▼───────┐   ┌────────▼────────┐
     │   Core ADB      │  │  Termux ADB   │   │   Termux:API    │
     │  (from host)    │  │ (on device)   │   │  (on device)    │
     │                 │  │               │   │                 │
     │  Screen control │  │ Screen control│   │  SMS, calls,    │
     │  + snapshots    │  │ + snapshots   │   │  location, etc  │
     └────────┬────────┘  └───────┬───────┘   └────────┬────────┘
              │                   │                     │
              │  ADB over USB     │  ADB over localhost │  termux-* CLI
              │  or WiFi          │  (wireless debug)   │  (no ADB)
              │                   │                     │
              └───────────────────┴─────────────────────┘
                              Android Device
```

---

## Module 1: Core ADB — Full Screen Control

**Who it's for:** QA teams, automation engineers, AI agent builders who want to control Android devices from a host machine (laptop, server, CI runner).

**How it connects:** USB cable, WiFi, or emulator. Uses `adb` directly.

### What your agent can do

| Capability | How |
|-----------|-----|
| **Read the screen** | `page.snapshot()` — pruned accessibility tree as YAML with `[ref=N]` markers |
| **Tap elements** | `page.tap(5)` — tap by ref number from snapshot |
| **Type text** | `page.type(3, 'hello')` — focus field + type |
| **Navigate** | `page.back()`, `page.home()`, `page.press('enter')` |
| **Scroll** | `page.scroll(ref, 'down')` — within any scrollable element |
| **Launch apps** | `page.launch('com.android.settings')` — by package name |
| **Take screenshots** | `page.screenshot()` — PNG buffer, ~0.5s |
| **Deep link** | `page.intent('android.settings.BLUETOOTH_SETTINGS')` |
| **Wait for state** | `page.waitForText('Success', 5000)` — poll until text appears |
| **Vision fallback** | `page.tapXY(x, y)` or `page.tapGrid('C5')` — when accessibility tree fails |

### Setup (one-time)

1. Install [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (puts `adb` in PATH)
2. On the phone: Settings > About phone > tap "Build number" 7 times > enable USB debugging
3. Connect USB, tap "Allow" on the debugging prompt
4. Verify: `adb devices` shows your device

### Quick start

```js
import { connect } from 'baremobile';

const page = await connect();
console.log(await page.snapshot());   // see what's on screen

await page.tap(5);                    // tap element ref 5
await page.type(3, 'hello world');    // type into ref 3
await page.launch('com.whatsapp');    // open WhatsApp
await page.screenshot();              // PNG buffer

page.close();
```

### What the agent sees

```yaml
- ScrollView [ref=1]
  - Group
    - Text "Settings"
  - ScrollView [ref=3]
    - List
      - Group [ref=4]
        - Text "Network & internet"
        - Text "Mobile, Wi-Fi, hotspot"
      - Group [ref=5]
        - Text "Connected devices"
        - Text "Bluetooth, pairing"
```

Compact, token-efficient. Only interactive elements get refs. Agent reads, picks a ref, acts.

---

## Module 2: Termux ADB — On-Device Screen Control

**Who it's for:** Autonomous agents that run on the phone itself (via [Termux](https://f-droid.org/packages/com.termux/)). No host machine, no USB cable. The phone controls itself.

**How it connects:** ADB over localhost. Same commands, same API — serial is just `localhost:PORT` instead of a USB address.

### What's different from Core ADB

Everything from Core ADB works identically. The only differences:

| | Core ADB | Termux ADB |
|---|---|---|
| Runs on | Host machine (laptop, server) | The phone itself (Termux) |
| Connection | USB cable or WiFi | Localhost (wireless debugging) |
| Connect call | `connect()` | `connect({ termux: true })` |
| Requires | `adb` on host | `android-tools` in Termux |

### Setup

```bash
# In Termux on the phone:
pkg install android-tools nodejs-lts

# Enable Wireless Debugging in Developer Options
# Pair and connect:
adb pair localhost:PORT CODE
adb connect localhost:PORT
```

### Quick start

```js
import { connect } from 'baremobile';

const page = await connect({ termux: true });  // auto-detect localhost ADB
console.log(await page.snapshot());
await page.tap(5);
```

### Use case: bareagent

An autonomous agent running on the phone itself. Reads its own screen, decides what to do, acts. Combine with Termux:API for full device access — screen control + SMS + location + camera in one agent.

---

## Module 3: Termux:API — Direct Android APIs

**Who it's for:** Agents that need Android capabilities beyond the screen — send SMS, make calls, read GPS, take photos, manage clipboard. Works with or without screen control.

**How it connects:** `termux-*` CLI commands. No ADB involved. Talks directly to Android APIs through the [Termux:API](https://f-droid.org/packages/com.termux.api/) addon app.

### Capabilities

| Function | What it does |
|----------|-------------|
| `smsSend(number, text)` | Send an SMS |
| `smsList({limit, type})` | Read SMS inbox |
| `call(number)` | Initiate a phone call |
| `location({provider})` | Get GPS/network location |
| `cameraPhoto(file)` | Capture a photo (JPEG) |
| `clipboardGet()` / `clipboardSet(text)` | Read/write clipboard |
| `contactList()` | List all contacts as JSON |
| `notify(title, content)` | Show a notification |
| `batteryStatus()` | Battery level, charging state |
| `volumeGet()` / `volumeSet(stream, vol)` | Read/set volume |
| `wifiInfo()` | Connected network details |
| `torch(on)` | Flashlight on/off |
| `vibrate()` | Vibrate the device |

### Setup

```bash
# Install Termux from F-Droid (NOT Google Play)
# Install Termux:API addon from F-Droid
# In Termux:
pkg install termux-api nodejs-lts
```

### Quick start

```js
import * as api from 'baremobile/src/termux-api.js';

await api.smsSend('+1555123456', 'Meeting at 3pm');
const battery = await api.batteryStatus();    // { percentage: 85, status: 'charging' }
const loc = await api.location();             // { latitude: 37.7749, longitude: -122.4194 }
await api.cameraPhoto('/tmp/photo.jpg');      // snap a photo
const contacts = await api.contactList();     // all contacts
```

### Combining with Termux ADB

The real power is both together — screen control + direct APIs:

```js
import { connect } from 'baremobile';
import * as api from 'baremobile/src/termux-api.js';

const page = await connect({ termux: true });

// Read a message on screen, then send a reply via SMS API
const snapshot = await page.snapshot();
// ... agent decides to reply ...
await api.smsSend('+1555123456', 'Got it, on my way');

// Check location, then search for it in Maps
const loc = await api.location();
await page.launch('com.google.android.apps.maps');
```

---

## Module 4: iOS — WebDriverAgent (WDA)

**Who it's for:** QA teams wanting iPhone control from Linux — no Mac, no Xcode. Same `snapshot()` → `tap(ref)` pattern as Android, backed by WDA over HTTP. Shared pruning pipeline — identical hierarchical YAML output.

**Status:** Full ref-based control — hierarchical accessibility tree, coordinate-based tap, type, scroll, swipe, screenshots, app lifecycle, unlock. All working. USB cable required (WiFi tunnel requires Mac/Xcode for pairing — not possible on Linux).

**Important:** iOS is QA/testing only. Personal assistant use case requires Android (ADB WiFi works natively, no cable needed). iOS requires USB because the WDA process depends on a USB tunnel (RemoteXPC) that cannot be established without Xcode WiFi pairing.

### What your agent can do

| Capability | How |
|-----------|-----|
| **Read the screen** | `page.snapshot()` — hierarchical YAML with `[ref=N]` markers (same format as Android) |
| **Tap elements** | `page.tap(1)` — coordinate tap at bounds center |
| **Type text** | `page.type(2, 'hello')` — coordinate tap to focus + WDA keys |
| **Navigate** | `page.back()` (searches refMap for back button), `page.home()` |
| **Scroll** | `page.scroll(ref, 'down')` — coordinate-based swipe within bounds |
| **Launch apps** | `page.launch('com.apple.Preferences')` — by bundle ID |
| **Take screenshots** | `page.screenshot()` — PNG buffer |
| **Wait for state** | `page.waitForText('Settings', 5000)` — poll until text appears |
| **Vision fallback** | `page.tapXY(x, y)` — coordinate-based tap |
| **Unlock device** | `page.unlock(passcode)` — unlock with passcode. Throws if passcode required but not provided, or wrong passcode. |

### Quick start

```js
import { connect } from 'baremobile/src/ios.js';

const page = await connect();
console.log(await page.snapshot());
// - App
//   - Window
//     - NavBar "Settings"
//       - Text "Settings"
//     - List [ref=1]
//       - Cell [ref=2] "Wi-Fi"
//       - Cell [ref=3] "Bluetooth"

await page.tap(2);                         // coordinate tap at bounds center
await page.waitForText('Wi-Fi', 10000);    // verify navigation
await page.type(4, 'network-name');        // type into search field
const png = await page.screenshot();       // visual verification
page.close();
```

### Architecture

```
WDA XML  →  translateWda()  →  node tree  →  prune()  →  formatTree()  →  YAML
                                                          (shared with Android)

`baremobile setup` (option 3) starts:
  1. USB tunnel (pymobiledevice3, elevated)
  2. DDI mount (developer disk image)
  3. WDA launch (XCUITestService)
  4. Port forward (usbmux.js)

connect() auto-discovers WDA:
  1. Cached WiFi — /tmp/baremobile-ios-wifi → direct HTTP
  2. USB — usbmux.js TCP proxy → get WiFi IP from /status → cache → switch to WiFi
  3. Fallback — localhost:8100

Port forwarding: Node.js usbmux client (src/usbmux.js) — replaces pymobiledevice3 forwarder.
```

Translation layer + shared pipeline. `translateWda()` converts WDA XML attributes to Android node shape, then `prune()` assigns refs and `formatTree()` produces indented YAML. Actions use coordinate taps from node bounds — no predicate lookups, no WDA element search.

### Requirements

| Requirement | Why |
|------------|-----|
| WDA on device | Signed with free Apple ID (7-day cert, re-sign weekly) |
| pymobiledevice3 | Setup only — tunnel, DDI mount, WDA launch. Python 3.12. Zero Python at runtime. |
| USB cable (required) | WiFi tunnel requires Mac/Xcode for WiFi pairing — not possible on Linux |
| Developer Mode on iPhone | Required for developer services |

**What you DON'T need:** No Mac, no Xcode, no Bluetooth adapter, no Python at runtime, no BLE pairing, no AssistiveTouch, no Full Keyboard Access.

### Setup

```bash
# Interactive setup wizard (guides through all steps, cross-platform):
baremobile setup          # 4 options: Android, iOS from scratch, start WDA, renew cert

# Individual commands:
baremobile ios resign     # re-sign WDA cert (7-day Apple free cert)
baremobile ios teardown   # kill tunnel/WDA/forward processes
```

### Prerequisites

| Requirement | Why |
|------------|-----|
| Apple developer account (free) | Signing WDA — free cert expires every 7 days |
| USB-C or Lightning cable | Required on Linux (WiFi tunnel needs Mac/Xcode) |
| pymobiledevice3 | Setup only — tunnel, DDI mount, WDA launch |
| AltServer-Linux | Re-signing WDA cert (placed at `.wda/AltServer`) |

### Re-signing WDA cert (every 7 days)

Free Apple ID certs expire after 7 days. baremobile tracks this and warns you:

```bash
baremobile ios resign   # interactive: prompts for Apple ID, password, 2FA
```

The MCP server auto-warns when the cert is >6 days old — the warning appears in the first iOS snapshot.

### CLI session (iOS)

```bash
baremobile open --platform=ios           # start iOS daemon
baremobile snapshot                      # YAML tree with iOS elements
baremobile tap 2                         # tap by ref
baremobile launch com.apple.Preferences  # launch Settings
baremobile close                         # shut down
```

### MCP usage (iOS)

All MCP tools accept optional `platform: "ios"`:
```
snapshot({platform: 'ios'})    → iOS accessibility tree
tap({ref: '2', platform: 'ios'}) → tap on iPhone
snapshot()                      → Android (default)
```

Both platforms can be used in the same MCP session — each gets its own lazy connection.

---

## CLI Session Mode

All modules can also be driven from the command line via `npx baremobile`. The CLI starts a background daemon that holds an ADB session — same as the library, but controlled via shell commands.

### Quick start

```bash
npx baremobile open                         # start daemon
npx baremobile launch com.android.settings  # open Settings
sleep 2
npx baremobile snapshot                     # prints .baremobile/screen-*.yml
npx baremobile tap 4                        # tap element
npx baremobile logcat                       # prints .baremobile/logcat-*.json
npx baremobile close                        # shut down
```

### Full command reference

| Category | Command | Description |
|----------|---------|-------------|
| Session | `open [--device=SERIAL] [--platform=android\|ios]` | Start daemon |
| | `close` | Shut down daemon |
| | `status` | Check if session is alive |
| Screen | `snapshot` | ARIA snapshot → `.baremobile/screen-*.yml` |
| | `screenshot` | PNG → `.baremobile/screenshot-*.png` |
| | `grid` | Screen grid info (for vision fallback) |
| Interaction | `tap <ref>` | Tap element by ref |
| | `tap-xy <x> <y>` | Tap by pixel coordinates |
| | `tap-grid <cell>` | Tap by grid cell (e.g. C5) |
| | `type <ref> <text> [--clear]` | Type text into field |
| | `press <key>` | Press key (back, home, enter, ...) |
| | `scroll <ref> <direction>` | Scroll (up/down/left/right) |
| | `swipe <x1> <y1> <x2> <y2> [--duration=N]` | Raw swipe |
| | `long-press <ref>` | Long press element |
| | `launch <pkg>` | Launch app by package name |
| | `intent <action> [--extra-string key=val ...]` | Deep navigation |
| | `back` | Press Android back |
| | `home` | Press Android home |
| Waiting | `wait-text <text> [--timeout=N]` | Poll until text appears |
| | `wait-state <ref> <state> [--timeout=N]` | Poll until state matches |
| Logging | `logcat [--filter=TAG] [--clear]` | Dump logcat → `.baremobile/logcat-*.json` |
| Setup | `setup` | Interactive setup wizard |
| | `ios resign` | Re-sign WDA cert (7-day Apple free cert) |
| | `ios teardown` | Kill iOS tunnel/WDA processes |
| MCP | `mcp` | Start MCP server (JSON-RPC over stdio) |

### Output conventions

All output goes to `.baremobile/` in the current directory. Action commands print `ok` to stdout. File-producing commands print the file path. Errors go to stderr with non-zero exit code.

### JSON mode for agents

Add `--json` to any command for machine-readable output — one JSON line per command:

```bash
baremobile open --json       # {"ok":true,"pid":1234,"port":40049,"outputDir":"..."}
baremobile snapshot --json   # {"ok":true,"file":".baremobile/screen-*.yml"}
baremobile tap 4 --json      # {"ok":true}
baremobile logcat --json     # {"ok":true,"file":"...","count":523}
# errors:
baremobile status --json     # {"ok":false,"error":"No session found."}
```

Every response has `ok: true|false`. File-producing commands include `file`. Errors include `error`. Agents parse one line per invocation — no text formatting to strip.

---

## Choosing the Right Module

### "I want to automate Android UI testing from my laptop"
→ **Core ADB.** Connect via USB, run tests from your machine.

### "I want an AI agent that lives on the phone and acts autonomously"
→ **Termux ADB + Termux:API.** Screen control + direct Android APIs, no host needed.

### "I just need to send SMS or read GPS from code"
→ **Termux:API.** No screen control needed, direct API access.

### "I want to test iOS apps from Linux"
→ **iOS module.** WDA-based — real element tree, native click, type, scroll. Same `snapshot()` → `tap(ref)` pattern as Android. USB required.

### "I want cross-platform test suites"
→ Core ADB for Android + iOS module for iPhone. Same agent, different devices.

---

## What baremobile handles for you

Things your agent doesn't have to think about:

- **Bloated UI trees** — 4-step pruning: collapse wrappers, drop empty nodes, dedup list items
- **200+ Android widget classes** — mapped to 27 simple roles (Button, Text, TextInput, Image...)
- **Text input quirks** — API 35+ space handling, shell character escaping
- **Binary output corruption** — `exec-out` for clean PNG bytes
- **Multi-device setups** — every command threads device serial
- **Element states** — `[disabled]`, `[checked]`, `[focused]`, `[selected]` in snapshots
- **Vision fallback** — when accessibility tree fails (Flutter, WebViews), use `screenshot()` + `tapXY()`

## What still needs the agent

| Gap | Why | Workaround |
|-----|-----|------------|
| Login / auth | App tokens are hardware-bound | Agent logs in via UI |
| WebView content | Shallow accessibility tree | Vision fallback, CDP bridge planned |
| CAPTCHAs | No programmatic solve | Vision model or skip |
| Screen unlock | Needs unlocked screen | `press('power')` + `swipe()` + `type()` for PIN |
| Multi-touch | ADB supports single-point only | `sendevent` planned |

---

## Links

- [Full API reference](../README.md#api)
- [Product roadmap](01-product/prd.md)
- [iOS details in PRD](01-product/prd.md) (Phase 2.7–3.0)
- [Dev setup guide](04-process/dev-setup.md)
