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
| 4 | **iOS (BLE HID + pymobiledevice3)** | iOS | QA | Screenshots + Bluetooth keyboard/mouse input. Vision-based — no accessibility tree. Full integration proven. | USB cable, Bluetooth adapter, Python 3.12 + 3.14, BlueZ 5.56+ |

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

## Module 4: iOS — BLE HID + pymobiledevice3

**Who it's for:** QA teams wanting iPhone control from Linux — no Mac, no Xcode, no app installed on the phone.

**Status:** Screenshots, app lifecycle, BLE keyboard, BLE mouse — all proven (Phase 2.7–2.8). Integration 6/6 passing.

### Architecture

```
Linux machine                              iPhone
┌──────────────────┐                 ┌──────────────┐
│  baremobile-ios   │                │              │
│                   │── USB ────────▶│ screenshots  │
│  pymobiledevice3  │                │ app launch   │
│  (Python)         │                │ app kill     │
│                   │                │              │
│                   │── Bluetooth ──▶│ tap (mouse)  │
│  BlueZ BLE HID   │                │ type (kbd)   │
│  (Python/D-Bus)   │                │              │
└──────────────────┘                 └──────────────┘
       ↑
  Node.js calls Python via child_process.execFile
```

Two channels:
- **USB (pymobiledevice3):** Screenshots, app launch/kill, process list, device info — called from Node.js via `child_process.execFile('python3.12', ['-m', 'pymobiledevice3', ...])`
- **Bluetooth (BLE HID):** Keyboard input → any text field. Mouse input → tap at coordinates (via AssistiveTouch). Python GATT server using BlueZ D-Bus API, called from Node.js via `child_process.execFile('python3', ['ble-hid-poc.py', ...])`. Uses system Python 3.14 (dbus-python/PyGObject are system packages).

### What works today

| Capability | Status | Latency |
|-----------|--------|---------|
| Screenshot | Working | ~2.5s |
| App launch | Working | ~4s |
| App kill | Working | ~4s |
| Device info | Working | <1s |
| Process list | Working | ~26s |
| Keyboard input (BLE) | **Working** | ~200ms/char |
| Mouse tap at coordinates (BLE) | **Working** | ~1-2s (move + click) |
| Integration (screenshot → tap → type → verify) | **Working** | ~40s full loop |

### What's being proven (BLE HID spike)

The BLE HID spike validates that Linux can act as a Bluetooth keyboard/mouse to iOS:

- **GATT server** — BlueZ D-Bus API hosting HID Service (UUID `0x1812`) with keyboard + mouse Report Map
- **Keyboard** — `send_key(char)`, `send_string(text)` → keystrokes into any focused text field
- **Mouse** — `move_mouse(dx, dy)`, `click()` → cursor movement + tap via AssistiveTouch
- **Pairing** — iPhone sees "baremobile" in Bluetooth settings → tap to pair, one-time
- **Integration** — screenshot (pymobiledevice3) → hardcoded tap → BLE mouse click → screenshot → verify

### Key difference from Android

No accessibility tree on iOS (Apple locks it to debug-mode apps). iOS automation is **vision-based**: screenshot → send to LLM/vision model → get coordinates → BLE tap → verify with screenshot.

### Requirements

| Requirement | Why |
|------------|-----|
| USB cable | WiFi locked down in iOS 17+ |
| Phone unlocked | Developer image mount needs it |
| Python 3.12 | pymobiledevice3 (3.14 has build failures with native deps) |
| Python 3.14 (system) | BLE HID — dbus-python/PyGObject are system packages |
| Bluetooth adapter | BLE HID input — must support peripheral role |
| BlueZ 5.56+ | Linux Bluetooth stack with LE-only mode (`ControllerMode = le`) |
| `dbus-python` + `PyGObject` | Python bindings for BlueZ D-Bus GATT API |
| AssistiveTouch on iPhone | Required for BLE mouse → tap conversion |

**What you DON'T need:** No Mac, no Xcode, no Apple Developer account, no app on the phone, no jailbreak.

### Setup

```bash
# Install pymobiledevice3
pip install pymobiledevice3

# Install BLE HID dependencies (Fedora)
sudo dnf install python3-dbus python3-gobject

# First-time iPhone setup (USB + hands on phone required)
./scripts/ios-tunnel.sh setup

# Start the USB bridge (each session)
./scripts/ios-tunnel.sh

# Run iOS tests
npm run test:ios
```

---

## Choosing the Right Module

### "I want to automate Android UI testing from my laptop"
→ **Core ADB.** Connect via USB, run tests from your machine.

### "I want an AI agent that lives on the phone and acts autonomously"
→ **Termux ADB + Termux:API.** Screen control + direct Android APIs, no host needed.

### "I just need to send SMS or read GPS from code"
→ **Termux:API.** No screen control needed, direct API access.

### "I want to test iOS apps from Linux"
→ **iOS module.** Screenshots + BLE keyboard/mouse proven. JS module wrapping it coming in Phase 2.9.

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
