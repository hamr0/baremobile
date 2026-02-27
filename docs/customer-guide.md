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
| 4 | **iOS (WDA)** | iOS | QA/testing only | Same `snapshot()` → `tap(ref)` as Android. Real accessibility tree via WDA, native element click, type, scroll, screenshots. | WDA on device, USB cable, Python 3.12 (setup only) |

Modules 1 and 2 are the same API — one runs on a host machine, the other on the phone itself. Module 3 adds direct Android APIs (SMS, GPS, camera) and pairs with Module 2 for full autonomous agents. Module 4 brings the same ref-based pattern to iOS.

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

**Who it's for:** QA teams wanting iPhone control from Linux — no Mac, no Xcode at runtime. Same `snapshot()` / `tap(ref)` pattern as Android, backed by WDA over HTTP.

**Status:** Full ref-based control working — accessibility tree, tap, type, scroll, swipe, screenshots, app lifecycle, unlock.

**Important:** iOS is QA/testing only. USB cable required — the WDA process depends on a USB tunnel (RemoteXPC) that cannot be established over WiFi without Xcode. For autonomous/personal-assistant use cases, use Android.

### What your agent can do

| Capability | How |
|-----------|-----|
| **Read the screen** | `page.snapshot()` — hierarchical YAML with `[ref=N]` markers (same format as Android) |
| **Tap elements** | `page.tap(1)` — coordinate tap at bounds center |
| **Type text** | `page.type(2, 'hello')` — coordinate tap to focus + WDA keys |
| **Navigate** | `page.back()` (finds back button in NavBar), `page.home()` |
| **Scroll** | `page.scroll(ref, 'down')` — coordinate-based swipe within bounds |
| **Launch apps** | `page.launch('com.apple.Preferences')` — by bundle ID |
| **Take screenshots** | `page.screenshot()` — PNG buffer |
| **Wait for state** | `page.waitForText('Settings', 5000)` — poll until text appears |
| **Unlock device** | `page.unlock(passcode)` — unlock with passcode |

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

WDA XML is translated to a common node tree, then run through the same prune/format pipeline as Android — identical YAML output.

```
WDA XML  →  translateWda()  →  node tree  →  prune()  →  formatTree()  →  YAML
```

Actions use W3C Actions API touch sequences at element bound coordinates — more reliable than WDA's `/wda/tap` endpoint, which silently fails on some elements. At runtime, all communication is pure HTTP to WDA. Python (pymobiledevice3) is only needed during setup for the USB tunnel, DDI mount, and WDA launch. The MCP server auto-reconnects if WDA dies mid-session.

### Requirements

| Requirement | Why |
|------------|-----|
| WDA on device | Signed with free Apple ID (7-day cert, re-sign weekly) |
| USB cable | WiFi tunnel requires Mac/Xcode — not possible on Linux |
| Developer Mode on iPhone | Required for developer services |
| pymobiledevice3 | Setup only — tunnel, DDI mount, WDA launch. Python 3.12. |
| AltServer-Linux | Re-signing WDA cert (placed at `.wda/AltServer`) |

**What you DON'T need:** No Mac, no Xcode, no Bluetooth adapter, no Python at runtime.

### Setup

```bash
baremobile setup              # interactive wizard — option 2 (iOS from scratch) or option 3 (start WDA)
baremobile ios resign         # re-sign WDA cert (7-day Apple free cert, interactive)
baremobile ios teardown       # kill tunnel/WDA/forward processes
```

Free Apple ID certs expire after 7 days. The MCP server auto-warns when the cert is >6 days old.

---

## CLI and MCP

All modules are also available via CLI (`npx baremobile`) and MCP server. The CLI starts a background daemon that holds a device session. For iOS, all MCP tools accept `platform: "ios"`.

See the [README](../README.md) for the full CLI command reference.

---

## Choosing the Right Module

### "I want to automate Android UI testing from my laptop"
-> **Core ADB.** Connect via USB, run tests from your machine.

### "I want an AI agent that lives on the phone and acts autonomously"
-> **Termux ADB + Termux:API.** Screen control + direct Android APIs, no host needed.

### "I just need to send SMS or read GPS from code"
-> **Termux:API.** No screen control needed, direct API access.

### "I want to test iOS apps from Linux"
-> **iOS module.** WDA-based — real element tree, native click, type, scroll. Same `snapshot()` / `tap(ref)` pattern as Android. USB required.

### "I want cross-platform test suites"
-> Core ADB for Android + iOS module for iPhone. Same agent, different devices.

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
- [Dev setup guide](04-process/dev-setup.md)
