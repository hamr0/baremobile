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
1. ~~Get pymobiledevice3 taking screenshots over WiFi from Linux~~ **Done (USB) — Phase 2.7**
2. ~~Get BlueZ presenting as BLE HID keyboard, pair with iPhone~~ **Done (Phase 2.8) — keyboard proven**
3. ~~Get keyboard+mouse combo working simultaneously~~ **Done (Phase 2.8) — both reports subscribe, fixed Report ID + Appearance bugs**
4. ~~Test BLE HID mouse with AssistiveTouch — cursor movement + click → tap at coordinates~~ **Done (Phase 2.8) — mouse proven**
5. ~~Combine: screenshot → BLE tap → screenshot → BLE type → verify~~ **Done (Phase 2.8) — integration test 6/6 passing**
6. Enable Switch Control, send navigation commands via BLE
7. Combine: screenshot → vision → decide action → BLE HID input
8. If screen-only vision is too slow, evaluate adding WDA later

---

## 5. POC Results — pymobiledevice3 Spike

### What We Proved

Tested on Fedora 43, Python 3.12, pymobiledevice3 7.7.2, iPhone 13 mini (build 23D127).

| Capability | Status | Notes |
|-----------|--------|-------|
| Device detection | **Working** | Via usbmux — returns model, iOS version, UDID |
| Device info | **Working** | Full lockdown dump — CPU arch, WiFi MAC, serial, carrier |
| Developer Mode | **Working** | `reveal-developer-mode` makes toggle visible without Xcode |
| Developer image mount | **Working** | Auto-downloads + mounts personalized image via Apple TSS |
| Screenshot | **Working** | PNG capture, ~35 KB home screen, ~463 KB in-app |
| Process list | **Working** | Full process tree, 1 MB+ output |
| App launch | **Working** | Launch any app by bundle ID, returns PID |
| App kill | **Working** | Kill by PID |
| WiFi discovery | **Partial** | mDNS sees device, but WiFi pairing requires separate flow (not completed) |

### Performance

| Metric | Value |
|--------|-------|
| Screenshot latency | **avg 2.5s** (min 2.2s, max 2.6s) |
| Screenshot size | 35–463 KB (PNG, varies by screen content) |
| App launch time | ~4s (includes pymobiledevice3 CLI overhead) |
| App kill time | ~4s |
| Process list time | ~26s (large output, 1 MB+) |

The 2.5s screenshot latency includes pymobiledevice3 CLI startup overhead (~1s per invocation). A persistent connection (Python library mode or long-running process) would be faster. For comparison, baremobile's Android screenshot via ADB is ~0.5s.

### What Didn't Work

| Attempt | Result | Why |
|---------|--------|-----|
| WiFi screenshots (no USB) | **Failed** | iOS 17+ requires separate WiFi remote pairing — USB trust doesn't carry over. Apple intentionally locked this down. |
| `enable-developer-mode` via CLI | **Failed** | Blocked when passcode is set. Must use `reveal-developer-mode` + manual toggle. |
| `tunneld` auto-discovery | **Failed** | `lockdown start-tunnel` doesn't register with `tunneld`. Works fine with manual `--rsd` flag. |
| Python 3.14 | **Failed** | Native deps (lzfse, lzss) don't compile. Must use Python 3.12. |

### Setup Constraints

**One-time setup (requires USB + hands on phone):**
1. USB cable to establish trust ("Trust This Computer" prompt)
2. `reveal-developer-mode` → manually toggle Developer Mode in Settings → restart phone
3. Unlock phone for developer image mount

**Every session (USB stays plugged in):**
1. Start usbmuxd (or ensure systemd socket activation)
2. Start lockdown tunnel (requires sudo — creates TUN interface)
3. Mount developer image (once per phone reboot)
4. Note the RSD address from tunnel output

**Hard requirements:**
- USB cable (WiFi not proven on iOS 17+)
- Phone must be unlocked for developer image mount and screenshots
- Tunnel process must stay running (sudo)
- Python 3.12 (not 3.14)

**What you DON'T need:**
- No Mac
- No Xcode
- No Apple Developer account
- No app installed on the phone
- No jailbreak

### The Script

`scripts/ios-tunnel.sh` wraps the full setup:

```bash
./scripts/ios-tunnel.sh setup    # first-time: reveal dev mode, enable WiFi
./scripts/ios-tunnel.sh          # start bridge: usbmuxd + tunnel + dev image
./scripts/ios-tunnel.sh check    # validate all prerequisites
```

### Test Suite

8 tests in `test/ios/screenshot.test.js`:

```bash
RSD_ADDRESS="<host> <port>" npm run test:ios
```

Or set the RSD file and skip the env var:
```bash
echo "<host> <port>" > /tmp/ios-rsd-address
npm run test:ios
```

## 6. Where We Go From Here

### What pymobiledevice3 Gives Us (Architecture A baseline)

With just USB + pymobiledevice3, an agent can:
- **See the screen** — screenshot every 2.5s
- **Launch/kill apps** — by bundle ID
- **Monitor processes** — full process tree
- **Read device state** — battery, network, storage via lockdown
- **Access files** — read/write via AFC protocol
- **Automate Safari** — WebInspector protocol for web content

This is enough for **vision-based automation**: screenshot → send to LLM → get coordinates → tap. The missing piece is the tap — pymobiledevice3 has coordinate-based tap via DVT but it's underdocumented and may not work on all iOS versions.

### What's Missing for Full Control

| Gap | Solution | Effort |
|-----|----------|--------|
| **Touch input** | BLE HID mouse + AssistiveTouch | Spike needed |
| **Keyboard input** | BLE HID keyboard | Spike needed |
| **Full UI navigation** | BLE HID + Switch Control | Spike needed |
| **Accessibility tree** | WDA (needs Mac) or VoiceOver hack | Heavy |
| **WiFi (no cable)** | WiFi remote pairing | Apple-blocked, complex |
| **Faster screenshots** | Persistent Python connection or AirPlay capture | Medium |

### Use Cases With Current Capabilities

**Today (USB + pymobiledevice3 only):**
- Automated screenshot capture for QA visual regression
- App launch/kill orchestration for test suites
- Device state monitoring (battery, network, processes)
- Safari/WebView automation via WebInspector
- Log collection and crash report retrieval

**After BLE HID spike (Architecture C complete):**
- Full vision-based UI automation: screenshot → LLM → BLE tap
- Text entry into any app via BLE keyboard
- Automated user flow testing (signup, checkout, onboarding)
- Accessibility testing via Switch Control navigation
- Cross-platform test suites (Android via ADB, iOS via pymobiledevice3 + BLE)

**After WDA addition (Architecture B, needs Mac once):**
- Element-based automation (find button by label, tap it)
- Accessibility tree inspection without vision
- Faster automation loops (no LLM needed for element location)
- XPath/predicate queries for robust selectors

### BLE HID Input Spike (Phase 2.8 — IN PROGRESS)

The critical missing piece. Proves that a Linux machine can send taps and keystrokes to an iPhone via Bluetooth — no app install, no jailbreak, no cable.

Spike goals:
1. ~~Linux presents as BLE HID keyboard → pair with iPhone → type text~~ **PROVEN**
2. ~~Keyboard+mouse combo — both reports subscribe simultaneously~~ **PROVEN** (fixed Report ID + Appearance bugs)
3. ~~Linux presents as BLE HID mouse → enable AssistiveTouch → tap coordinates~~ **PROVEN**
4. Combine with screenshot: capture screen → decide where to tap → BLE tap → capture result

If BLE HID works, Architecture C is complete and we have a fully functional iOS automation path from Linux.

#### Bugs fixed during spike

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Two "baremobile" entries on iPhone | Classic BT + LE both advertising | `ControllerMode = le` |
| `notifying=False` despite connection | `NoInputNoOutput` = unauthenticated | `KeyboardDisplay` agent |
| iOS reads HID Info but not Report Map | Insufficient security level | `secure-read` on Report Map + Report Reference |
| Keyboard drops when mouse connects | LED Output Report Reference had Report ID 0 (should be 1) | Fixed to match keyboard collection |
| Keyboard drops when mouse connects | Appearance `0x03C1` (Keyboard) confused iOS on mouse reports | Changed to `0x03C0` (Generic HID) |
| iOS software keyboard hidden | Expected behavior — BLE hardware keyboard connected | Not a bug. Benefits automation (more screen visible in screenshots) |
| Mouse moves tiny amount | iOS clamps single-report movement magnitude | Send rapid small-step reports (10 units/report, 8ms intervals) like a real mouse sensor |

#### iOS BLE HID behaviors observed

- iOS hides software keyboard when any BLE keyboard is connected (by design)
- Software keyboard reappears immediately on BLE disconnect
- iOS reads all Report Reference descriptors on connect to map Report IDs to collections
- iOS writes LED Output Report (Caps Lock status) on keyboard subscribe
- iOS reads Battery Level on initial connect
- Mouse requires rapid small-step reports (10 units, 8ms interval) — iOS clamps single-report magnitude
- Relative mouse movement only — for absolute screen positioning, home to corner first then move to target
- AssistiveTouch cursor + click = finger tap at cursor position — confirmed working

### BLE HID Pre-Spike Findings

Validated before writing code:

| Check | Result | Detail |
|-------|--------|--------|
| BlueZ version | **5.85** | Supports GATT server (peripheral) role. Minimum needed: 5.56. |
| Bluetooth adapter | **Intel 9460/9560** | Supports peripheral role + 6 advertising instances. Confirmed via `btmgmt info`. |
| Python D-Bus bindings | **Available** | `python3-dbus` + `python3-gobject` in Fedora repos. Required for BlueZ GATT API. |
| Reference implementation | **HeadHodge HOGP gist** | Python BLE HID keyboard using BlueZ D-Bus GATT server on RPi4. Closest to our needs. |
| iOS BLE HID support | **Native** | Any BLE HID keyboard/mouse pairs without app install. AssistiveTouch enables mouse→tap. |
| BlueZ input plugin conflict | **Known** | Must disable `input` plugin in `/etc/bluetooth/main.conf` to prevent BlueZ from claiming HID devices as local input. |

**Key reference:** [HeadHodge HOGP keyboard gist](https://gist.github.com/HeadHodge/2d3dc6dc2dce03cf82f61d8231e88144) — Python GATT server implementing HID Service (0x1812) with Report Map, Protocol Mode, HID Info. Our POC adapts this for combined keyboard + mouse with iOS-specific requirements (encrypted characteristics, bonding).

**Python deps needed:**
- `dbus-python` — D-Bus bindings for registering GATT application with BlueZ
- `PyGObject` (gi) — GLib main loop for async BLE event handling
- Install: `sudo dnf install python3-dbus python3-gobject` (Fedora) or `pip install dbus-python PyGObject`

**BlueZ config change needed:**
```ini
# /etc/bluetooth/main.conf
[General]
DisablePlugins = input
```
Then: `sudo systemctl restart bluetooth`

This prevents BlueZ from treating our GATT HID service as a local input device.

---

For setup instructions, packages, and troubleshooting, see [04-process/dev-setup.md](../04-process/dev-setup.md#ios-researchspike--not-yet-built).
