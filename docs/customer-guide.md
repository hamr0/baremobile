# baremobile — Customer Guide

> Control any phone from code. Android today, iOS coming.

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
| 4 | **iOS (USB/WiFi + BLE HID + pymobiledevice3)** | iOS | QA | Accessibility snapshots + `tap(ref)` via Full Keyboard Access + screenshots. Same `snapshot()` → `tap(ref)` pattern as Android. Cable-free possible: WiFi for device communication, Bluetooth for input. | Bluetooth adapter, Python 3.12 + 3.14, BlueZ 5.56+. One-time USB for initial pairing. Full Keyboard Access enabled on iPhone. |

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

## Module 4: iOS — WiFi + BLE HID + pymobiledevice3

**Who it's for:** QA teams wanting iPhone control from Linux — no Mac, no Xcode, no app installed on the phone. Fully cable-free after initial setup.

**Status:** Accessibility snapshots, focus-based tap, screenshots, app lifecycle, BLE keyboard/mouse — all working. Cable-free via WiFi tunnel + Bluetooth.

### What your agent can do

| Capability | How |
|-----------|-----|
| **Read the screen** | `page.snapshot()` — accessibility elements as YAML with `[ref=N]` markers |
| **Tap elements** | `page.tap(1)` — focus-navigate + Enter (requires VoiceOver), or `page.tapXY(x, y)` — BLE mouse |
| **Type text** | `page.type('hello')` — BLE HID keyboard |
| **Navigate** | `page.back()`, `page.home()`, `page.press('enter')` |
| **Launch apps** | `page.launch('com.apple.Preferences')` |
| **Take screenshots** | `page.screenshot()` — PNG buffer |
| **Wait for state** | `page.waitForText('Settings', 5000)` — poll until text appears |
| **Vision fallback** | `page.tapXY(x, y)` — BLE HID mouse for coordinate-based tap |

### Quick start

```js
import { connect } from 'baremobile/src/ios.js';

const page = await connect();
console.log(await page.snapshot());
// - Header [ref=0] "Settings"
// - Button [ref=1] "Wi-Fi" (vanCampers)
// - Button [ref=2] "Bluetooth"

await page.tapXY(187, 300);                // BLE mouse tap
await page.waitForText('Wi-Fi', 10000);    // verify navigation
await page.type('network-name');           // BLE keyboard
const png = await page.screenshot();       // visual verification
page.close();
```

### Architecture

```
Linux machine                              iPhone
┌──────────────────┐                 ┌──────────────┐
│  baremobile-ios   │                │              │
│                   │── WiFi ───────▶│ snapshots    │
│  pymobiledevice3  │   (tunnel)     │ screenshots  │
│  (Python)         │                │ app launch   │
│                   │                │ focus nav    │
│                   │── Bluetooth ──▶│ tap (Enter)  │
│  BlueZ BLE HID   │                │ type (kbd)   │
│  (Python/D-Bus)   │                │ swipe (mouse)│
└──────────────────┘                 └──────────────┘
       ↑
  Node.js calls Python via child_process.execFile
```

Two wireless channels:
- **WiFi (pymobiledevice3 tunnel):** Accessibility snapshots (`iter_elements()`), screenshots, app launch/kill, focus navigation (`move_focus()`) — all over WiFi after one-time USB pairing
- **Bluetooth (BLE HID):** Keyboard input → any text field. Mouse → tap at coordinates. Enter key → activate focused element. Python GATT server using BlueZ D-Bus API.

### What works

| Capability | Status | Latency |
|-----------|--------|---------|
| Accessibility snapshot | **Working** | ~3-5s |
| Focus-based tap | **Working** | ~2-3s |
| Screenshot | Working | ~2.5s |
| App launch | Working | ~4s |
| App kill | Working | ~4s |
| Keyboard input (BLE) | Working | ~200ms/char |
| Mouse tap at coordinates (BLE) | Working | ~1-2s |
| WiFi tunnel | **Working** | Same as USB |
| Cable-free loop (snapshot → tap → verify) | **Working** | ~10s |

### Requirements

| Requirement | Why |
|------------|-----|
| One-time USB | Initial trust + `remote pair` for WiFi access. Then cable-free. |
| Phone unlocked | Developer image mount needs it |
| Python 3.12 | pymobiledevice3 (3.14 has build failures with native deps) |
| Python 3.14 (system) | BLE HID — dbus-python/PyGObject are system packages |
| Bluetooth adapter | BLE HID input — must support peripheral role |
| BlueZ 5.56+ | Linux Bluetooth stack with LE-only mode (`ControllerMode = le`) |
| `dbus-python` + `PyGObject` | Python bindings for BlueZ D-Bus GATT API |
| AssistiveTouch on iPhone | Required for BLE mouse → tap conversion (coordinate fallback only) |

**What you DON'T need:** No Mac, no Xcode, no Apple Developer account, no app on the phone, no jailbreak, no permanent USB cable.

### Setup

```bash
# Install pymobiledevice3
pip install pymobiledevice3

# Install BLE HID dependencies (Fedora)
sudo dnf install python3-dbus python3-gobject

# First-time iPhone setup (USB required once)
./scripts/ios-tunnel.sh setup    # enables dev mode, WiFi pair

# Start the bridge (each session — pick one)
./scripts/ios-tunnel.sh              # USB tunnel + BLE HID
./scripts/ios-tunnel.sh --wifi       # WiFi tunnel + BLE HID (cable-free)

# Run iOS tests
npm run test:ios
```

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
| Session | `open [--device=SERIAL]` | Start daemon |
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
→ **iOS module.** Accessibility snapshots + focus-based tap + BLE keyboard/mouse. Cable-free after one-time USB setup. Same `snapshot()` → `tap(ref)` pattern as Android.

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
- [iOS exploration & spike results](00-context/ios-exploration.md)
- [Dev setup guide](04-process/dev-setup.md)
