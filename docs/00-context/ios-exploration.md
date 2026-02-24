# iOS Exploration — Bridging to iPhone Control

baremobile controls Android via ADB — a debug bridge baked into the OS. iOS has no equivalent for third parties. This doc explores what bridges exist and which are worth building on.

## 1. Existing Interfaces on Every iPhone

| Interface | What it gives you | Triggered by |
|-----------|------------------|-------------|
| **iOS Shortcuts** | Native actions, HTTP requests, app launch, settings | Webhook, NFC, BLE connect/disconnect, time, location |
| **Screen Mirroring (AirPlay)** | Pixel stream out over WiFi | Built-in, read-only |
| **Bluetooth LE** | iPhone as BLE peripheral or central | Standard pairing |
| **Switch Control** | Full UI navigation via external input | BLE HID keyboard/switch |
| **AssistiveTouch** | Pointer/mouse control, cursor = finger tap | BLE HID mouse device |
| **libimobiledevice / pymobiledevice3** | Screenshots, app lifecycle, syslog, file access, developer services | USB or WiFi (same network) |
| **WebDriverAgent** | Full UI automation REST API (W3C WebDriver) | XCTest runner on device |
| **Supervised Mode + MDM** | Remote profiles, app management | Device enrollment |
| **VoiceOver** | Accessibility tree read aloud | Audio capture → STT |

## 2. Why pymobiledevice3 Over WDA-Without-Appium

Short answer: pymobiledevice3 is the right **foundation layer**, but WDA wins for UI automation. They solve different problems.

### pymobiledevice3 — What It Actually Does Today

[doronz88/pymobiledevice3](https://github.com/doronz88/pymobiledevice3) — pure Python, v7.0.7+, actively maintained.

**Works out of the box on Linux, no Mac, no Apple Developer account:**
- Screenshots via `dvt screenshot`
- App launch/kill via `dvt launch` / `dvt kill`
- Process listing via `dvt sysmon`
- Location simulation via `dvt simulate-location`
- System logging (`dvt oslog`, `syslog`)
- Network packet capture (PCAP)
- File system access (AFC protocol)
- Crash reports, profiles, provisioning
- WebInspector automation (Safari/WebView)
- KDebug event tracing (strace-like)

**What it can't do well:**
- No full accessibility tree dump for production apps
- `AccessibilityAuditService` only works with debug-mode apps
- UI interaction is coordinate-based via DVT, not element-based
- No XPath/accessibility-ID element queries

### WDA — What It Requires

WebDriverAgent is an XCTest bundle exposing W3C WebDriver REST API on port 8100.

**Hard requirements:**
- **Mac with Xcode** to build (one-time, but mandatory)
- **Code signing** — free Apple ID = re-sign every 7 days; paid ($99/yr) = annual
- **Device must stay unlocked** with WDA in foreground
- **XCTest session instability** — crashes after extended runtime, needs periodic restart
- iOS 17+ needs `devicectl` instead of `xcodebuild` for launch

**What it gives you (that pymobiledevice3 can't):**
- Full accessibility tree: `GET /source` → XML/JSON hierarchy
- Element queries: by accessibility ID, XPath, predicate string, class chain
- Semantic tap/type/swipe on elements (not just coordinates)
- MJPEG video stream on port 9100

### The Comparison

| | pymobiledevice3 | WDA |
|---|---|---|
| Full accessibility tree | No (audit only, debug apps) | Yes — complete hierarchy |
| Element-based interaction | No | Yes — find + tap/type/swipe |
| Coordinate-based tap | Yes (DVT) | Yes |
| Screenshot | Yes | Yes |
| App launch/kill | Yes | Yes |
| Runs on Linux natively | Yes | HTTP client only; build needs Mac |
| Signing required | No | Yes (7-day or annual) |
| Works on production apps | Limited UI control | Yes |
| Persistent operation | Yes (no XCTest) | Needs restart/monitoring |
| Device management | Full (files, logs, profiles) | None |

### The Practical Play

Use **both** — pymobiledevice3 as the device management + transport layer (same role as ADB in baremobile), and WDA as the UI automation engine when full element-based control is needed.

But there's a catch: WDA requires a Mac to build. For a truly Mac-free path, we need the BLE bridge.

## 3. Linux-as-Bluetooth-HID — No Extra Hardware Needed

The "hey blue" approach (dedicated BLE device on the phone) is overkill. **Any Linux machine with a Bluetooth adapter can present itself as a BLE HID keyboard/mouse to an iPhone.** No ESP32, no Raspberry Pi dongle — just BlueZ.

### How It Works

iOS natively accepts BLE HID input — this is how every third-party Bluetooth keyboard works. No jailbreak, no special mode.

**BLE HID Keyboard** — pairs normally, types directly into any app.

**BLE HID Mouse** — requires AssistiveTouch enabled (Settings > Accessibility > Touch > AssistiveTouch > Pointer Devices). A circular cursor appears; click = finger tap at cursor position.

**Switch Control** — each key on a BLE keyboard can be a "switch" (Settings > Accessibility > Switch Control > Switches > Add New Switch > External). Gives full UI traversal: item scanning, point scanning, gestures.

### Linux Setup (BlueZ)

Requirements:
- BlueZ 5.56+ (ships with most modern distros)
- BLE-capable Bluetooth adapter (most built-in laptop adapters work)
- Set `ControllerMode = le` in `/etc/bluetooth/main.conf`

The Linux machine runs a GATT server implementing:
- HID Service (UUID `0x1812`) with Report Map, Report characteristics
- Device Information Service
- Battery Service (optional but iOS expects it)

**Critical:** iOS requires encrypted read on Report Map/Report Reference characteristics — the BLE link must be bonded.

### Existing Projects

| Project | Type | iOS support |
|---------|------|------------|
| [**btkbdd**](https://linux.die.net/man/8/btkbdd) | Classic BT keyboard daemon | Yes — explicitly supports Apple/Darwin devices |
| [**EmuBTHID**](https://github.com/Alkaid-Benetnash/EmuBTHID) | Classic BT keyboard+mouse | BlueZ-based, working |
| [**HIDClient-Bluez5**](https://github.com/505e06b2/HIDClient-Bluez5) | Classic BT keyboard+mouse | Updated for modern BlueZ |
| [HeadHodge HOGP gist](https://gist.github.com/HeadHodge/2d3dc6dc2dce03cf82f61d8231e88144) | BLE HID (HOGP) keyboard | RPi4 example, Python |

**btkbdd** is most relevant — it implements Apple-specific HID requirements (report protocol mode, robust reconnection).

iOS supports **both** Classic Bluetooth HID and BLE HID for keyboards/mice. For Linux peripheral emulation, BLE is simpler (better BlueZ support for acting as peripheral).

### What This Gives Us for Automation

| Channel | Method | Limitation |
|---------|--------|-----------|
| **Text input** | BLE HID keyboard → direct keystrokes | Works in any focused text field |
| **Coordinate tap** | BLE HID mouse + AssistiveTouch | Need to know where to tap |
| **Full UI navigation** | BLE HID → Switch Control | Slower (scanning-based), but reaches everything |
| **Screen read** | ??? | This is the gap — BLE HID is input only |

**The missing piece is output.** BLE HID gives input but no screen feedback. Options to close the loop:

1. **pymobiledevice3 screenshots** — WiFi, works on Linux, no signing
2. **AirPlay mirroring capture** — pixel stream over WiFi, open-source receivers exist
3. **VoiceOver audio capture** — accessibility tree via audio → STT (terrible latency)

## 4. The Three Viable Architectures

### A. pymobiledevice3 Only (Simplest, Limited UI)

```
Agent → baremobile-ios → pymobiledevice3 CLI → WiFi/USB → iPhone
                              ↓
                    screenshots + coordinate tap + app lifecycle
```

- Zero extra requirements on Linux
- No signing, no Mac
- **Gap:** No accessibility tree, coordinate-only taps

### B. pymobiledevice3 + WDA (Full Control, Needs One-Time Mac)

```
Agent → baremobile-ios → HTTP → WDA (on device, port 8100)
                ↘ pymobiledevice3 → device management + port forward
```

- Full accessibility tree + element interaction
- WDA built once on Mac, deployed via pymobiledevice3
- **Gap:** Signing expiry (7 days free, 1 year paid), session instability

### C. BLE HID + pymobiledevice3 Screenshots (No Mac, No Signing, Zero Deps on Phone)

```
Agent → baremobile-ios → BlueZ BLE HID → Bluetooth → iPhone (input)
                ↘ pymobiledevice3 → WiFi → iPhone (screenshots)
```

- No Mac, no signing, no app installed on phone
- Works with Switch Control for full navigation
- Works with AssistiveTouch for coordinate taps
- pymobiledevice3 for screenshots closes the feedback loop
- **Gap:** Slower input (BLE latency), Switch Control scanning is sequential

### Recommendation

**Start with Architecture C** — it's the most "baremobile-like" in philosophy:
- Zero dependencies on the phone (no app install, no signing)
- Works from Linux with standard hardware
- No vendor toolchain needed
- Mirrors baremobile's approach: external control, accessibility-based navigation

Spike order:
1. Get pymobiledevice3 taking screenshots over WiFi from Linux
2. Get BlueZ presenting as BLE HID keyboard, pair with iPhone
3. Enable Switch Control, send navigation commands via BLE
4. Combine: screenshot → vision → decide action → BLE HID input
5. If screen-only vision is too slow, evaluate adding WDA later

---

For setup instructions, packages, and troubleshooting, see [04-process/dev-setup.md](../04-process/dev-setup.md#ios-researchspike--not-yet-built).
