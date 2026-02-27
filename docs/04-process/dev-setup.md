# Development Setup & Testing

> Single reference for all prerequisites, environment setup, and tests — split by platform.

## Run tests

```bash
node --test test/unit/*.test.js test/integration/*.test.js
```

176 tests, 13 test files, zero test dependencies. Integration tests auto-skip when no ADB device is available.

```
          ┌─────────┐
          │  E2E    │  Manual verified flows (Bluetooth toggle,
          │  (0)    │  SMS send, emoji, file attach — see blueprint)
          ├─────────┤
          │ Integr. │  26 tests — real device, full pipeline
          │  (26)   │  connect (16) + CLI session (10)
          ├─────────┤
          │  Unit   │  176 tests — pure functions, no device needed
          │  (176)  │  xml, prune, aria, interact, termux, termux-api,
          │         │  mcp, ios, usbmux, setup, cli
          └─────────┘
```

**Unit tests** run everywhere (CI, no device). **Integration tests** need an emulator or device. **E2E flows** are manually verified and documented in the blueprint — multi-step agent scenarios too slow/flaky for automated runs.

---

## Shared

| Dependency | Version | Install |
|-----------|---------|---------|
| **Node.js** | >= 22 | `dnf install nodejs` / `apt install nodejs` / [nvm](https://github.com/nvm-sh/nvm) |

---

## Android

### Core ADB — host machine setup

**System packages (Fedora):**

```bash
# Emulator GPU/audio dependencies
sudo dnf install -y pulseaudio-libs mesa-dri-drivers mesa-vulkan-drivers vulkan-loader

# Java (sdkmanager needs JDK 17+; any version >= 17 works)
# Usually pre-installed on Fedora — check with: java -version
sudo dnf install -y java-17-openjdk-headless

# KVM (hardware acceleration — emulator is unusable without it)
# Check: ls -la /dev/kvm
# If missing: sudo dnf group install --with-optional virtualization
# If permission denied: sudo usermod -aG kvm $USER && re-login
```

**32-bit libraries (only if emulator fails to launch):**

```bash
sudo dnf install -y \
  glibc.i686 \
  libstdc++.i686 \
  libX11.i686 \
  libXrender.i686 \
  libXrandr.i686 \
  pulseaudio-libs.i686
```

**Android SDK:**

```bash
export ANDROID_HOME="$HOME/android-sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools"

# Download (check https://developer.android.com/studio#command-line-tools-only for latest)
cd /tmp
curl -O https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip
unzip -qo commandlinetools-linux-14742923_latest.zip
mv cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
```

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
export ANDROID_HOME="$HOME/android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export PATH="$ANDROID_HOME/emulator:$PATH"
```

**SDK components + emulator:**

```bash
# Accept licenses
yes | sdkmanager --licenses

# Install tools + system image
sdkmanager "platform-tools" "emulator" \
  "system-images;android-35;google_apis_playstore;x86_64" \
  "platforms;android-35"

# Create AVD
avdmanager create avd \
  --name "baremobile-test" \
  --package "system-images;android-35;google_apis_playstore;x86_64" \
  --device "pixel_9"

# Launch (with window)
emulator -avd baremobile-test -gpu host &

# Launch (headless, for CI)
emulator -avd baremobile-test -no-window -no-audio &

# Wait for boot
adb wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'
```

**Verify:**

```bash
adb devices                          # should show emulator-5554
adb shell uiautomator dump /dev/tty  # should return XML tree
node --test test/unit/*.test.js      # unit tests (no device needed)
node --test test/integration/*.test.js  # integration tests (needs emulator)
```

**Package summary:**

| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | >= 22 | Runtime |
| Java | >= 17 | sdkmanager/avdmanager |
| Android cmdline-tools | latest | sdkmanager, avdmanager |
| platform-tools | latest | adb |
| emulator | latest | Android emulator |
| system-images;android-35;google_apis_playstore;x86_64 | latest | Emulator OS image |
| KVM | kernel module | Hardware acceleration |

### Core ADB tests

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/xml.test.js` | 12 | `parseBounds` (3): standard, empty, malformed. `parseXml` (9): single node, nested tree, self-closing, editable detection, empty/error input, all 12 attributes, XML entity decoding |
| `test/unit/prune.test.js` | 18 | Collapse single-child wrappers, keep ref nodes, drop empty leaves, ref assignment, dedup same-text siblings, skip dedup on ref nodes, refMap, null root, contentDesc, states, isInternalName detection (5), internal name filtering in shouldKeep (3) |
| `test/unit/aria.test.js` | 10 | `shortClass` (5): core widgets, layouts→Group, AppCompat/Material, unknown→last segment, empty→View. `formatTree` (5): all fields + ref + states, nesting, disabled, multiple states, empty node |
| `test/unit/interact.test.js` | 14 | `buildGrid` (7): column/row sizing, cell resolution, errors, text. Error handling (7): press/tap/scroll/type/longPress validation |
| `test/integration/connect.test.js` | 16 | Page object, snapshot, launch, back, screenshot, grid, tapXY, tapGrid, intent, waitForText (2), tap by ref, type, scroll, swipe, home |

### Termux ADB — on-device screen control

No host-side setup needed beyond Core ADB. Testing uses the same emulator.

**Emulator testing setup:**

```bash
# Enable wireless debugging on the emulator
adb -s emulator-5554 tcpip 5555

# Forward a port to simulate localhost access
adb -s emulator-5554 forward tcp:5555 tcp:5555

# Connect through localhost (same as Termux would)
adb connect localhost:5555

# Verify
adb devices  # should show localhost:5555
```

**On real device (inside Termux):**

```bash
# Install in Termux:
pkg install android-tools nodejs-lts

# Enable Wireless Debugging: Settings → Developer options → Wireless debugging → ON
# Tap "Pair device with pairing code" — note port + code
adb pair localhost:PORT CODE

# Note the CONNECT port (different from pairing port, shown on Wireless debugging screen)
adb connect localhost:PORT

# Verify
adb devices  # should show localhost:PORT  device
```

**Package summary:**

| Component | Where | Purpose |
|-----------|-------|---------|
| android-tools | Termux (`pkg install`) | adb client inside Termux |
| nodejs-lts | Termux (`pkg install`) | Node.js runtime inside Termux |
| Wireless debugging | Android 11+ setting | localhost ADB access |

**Tests:**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/termux.test.js` | 14 | `isTermux` (2): env var, path fallback. `findLocalDevices` (2): live adb + empty. `adbPair`/`adbConnect` (2): command construction. `resolveTermuxDevice` (1): errors. Parsing (7): typical output, non-localhost, offline, multiple devices, empty, mixed, whitespace |

All Core ADB integration tests apply identically (same `adb.js`, different serial).

### Termux:API — direct Android APIs

**Emulator testing setup:**

Sideload Termux + Termux:API APKs onto emulator:

```bash
# Download from F-Droid (or use cached APKs)
# com.termux_1022.apk + com.termux.api_1002.apk

adb install com.termux_1022.apk
adb install com.termux.api_1002.apk

# Grant storage permission (needed for file operations)
adb shell pm grant com.termux android.permission.WRITE_EXTERNAL_STORAGE
adb shell appops set com.termux MANAGE_EXTERNAL_STORAGE allow

# Open Termux, then inside Termux terminal:
pkg install termux-api nodejs-lts
```

**Validate (inside Termux):**

```bash
termux-battery-status          # should return JSON
termux-clipboard-set "test"
termux-clipboard-get           # should return "test"
termux-volume                  # should list stream volumes
termux-wifi-connectioninfo     # should return JSON
termux-vibrate                 # device should vibrate
```

**Not testable on emulator (needs real device):**

| Command | Why |
|---------|-----|
| `termux-sms-send` / `termux-sms-list` | No SIM card |
| `termux-telephony-call` | No SIM card |
| `termux-location` | No GPS hardware |
| `termux-camera-photo` | No camera hardware |
| `termux-contact-list` | No contacts on fresh emulator |

**Package summary:**

| Component | Where | Purpose |
|-----------|-------|---------|
| Termux APK | F-Droid / sideload | Terminal emulator for Android |
| Termux:API APK | F-Droid / sideload | Android API bridge addon |
| termux-api | Termux (`pkg install`) | CLI tools for Termux:API |
| nodejs-lts | Termux (`pkg install`) | Node.js runtime inside Termux |

**Tests:**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/termux-api.test.js` | 18 | Module exports (2): all 16 functions present. `isAvailable` (1): false on non-Termux. ENOENT errors (15): all API functions throw correctly |

### CLI & MCP

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/cli.test.js` | 10 | Argument parsing, flag handling, command dispatch |
| `test/unit/mcp.test.js` | 16 | Tool list (9): count, names, schemas, params, find_by_text. JSON-RPC dispatch (5): init, notifications, tools/list, errors. saveSnapshot (2): file write + maxChars |
| `test/integration/cli.test.js` | 10 | open, status, snapshot, launch+snapshot, tap, back, screenshot, logcat, close, status-after-close |

### Android E2E flows (manually verified)

| Flow | Steps |
|------|-------|
| Open app + read screen | launch Settings → snapshot → verify text |
| Search by typing | Settings → tap search → type "wifi" → verify results |
| Navigate back/home | press back, press home → verify screen change |
| Scroll long lists | Settings → scroll down → verify new items |
| Send SMS | Messages → new chat → recipient → compose → send |
| Insert emoji | Compose → emoji panel → tap emoji → verify in input |
| File attachment | Compose → + → Files → picker → select file |
| Dismiss dialogs | Dialog appears → read text → tap OK |
| Toggle Bluetooth | Settings → Connected devices → BT → toggle off/on |
| Screenshot capture | screenshot() → verify PNG magic bytes |
| Tap by coordinates | tapXY(540, 1200) on home screen |
| Tap by grid cell | tapGrid('E10') → resolves + taps correctly |

---

## iOS

> QA only — USB required on Linux. See [ios-exploration.md](../00-context/ios-exploration.md) for full research.

### Quick start

```bash
# Interactive wizard handles everything (Linux, macOS, WSL):
baremobile setup     # pick option 2 (from scratch) or 3 (start WDA server)
```

The setup wizard detects your OS and package manager, checks prerequisites, and walks through each step with platform-specific install instructions.

### Prerequisites

| Component | Linux (dnf) | Linux (apt) | macOS |
|-----------|-------------|-------------|-------|
| pymobiledevice3 | `pip3 install pymobiledevice3` | `pip3 install pymobiledevice3` | `pip3 install pymobiledevice3` or `brew install` |
| usbmuxd | Usually pre-installed | Usually pre-installed | Built-in |
| libdns_sd | `dnf install avahi-compat-libdns_sd` | `apt install libavahi-compat-libdnssd-dev` | Built-in |
| AltServer | [AltServer-Linux](https://github.com/NyaMisty/AltServer-Linux/releases) → `.wda/AltServer` | Same | `brew install altserver` or altstore.io |
| WebDriverAgent.ipa | Place at `.wda/WebDriverAgent.ipa` | Same | Same |

**Package summary:**

| Component | Version | Purpose |
|-----------|---------|---------|
| pymobiledevice3 | >= 7.7.0 | Setup only — tunnel, DDI mount, WDA launch. Zero Python at runtime. |
| usbmuxd | any | USB mux daemon for iOS device communication |
| AltServer-Linux | latest | Signing WDA with free Apple ID (7-day cert) |
| libdns_sd | any | mDNS — required by pymobiledevice3 |
| Python | 3.12 | pymobiledevice3 runtime |

### iPhone setup (one-time, USB required)

1. Connect iPhone via USB, tap "Trust This Computer"
2. Enable Developer Mode: Settings > Privacy & Security > Developer Mode > ON (reboot)
3. Enable UI Automation: Settings > Developer > Enable UI Automation > ON
4. Sign & install WDA via AltServer (wizard handles this)
5. Trust developer profile: Settings > General > VPN & Device Management

### Each session

```bash
baremobile setup     # option 3: Start iPhone WDA server
# Starts tunnel (elevated), mounts DDI, launches WDA, port forwards 8100
# When done:
baremobile ios teardown
```

### Every 7 days: Re-sign WDA cert

```bash
baremobile setup     # option 4: Renew iPhone WDA cert
# or:
baremobile ios resign
```

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `FileNotFoundError` on usbmux socket | usbmuxd not running → `sudo usbmuxd -f -v` |
| `No module named 'pymobiledevice3'` under sudo | The wizard uses `pkexec env PYTHONPATH=...` to handle this |
| Developer Mode not visible in Settings | pymobiledevice3: `mounter reveal-developer-mode`, force-close Settings, reopen |
| `invalid code signature` | Trust profile: Settings > General > VPN & Device Management |
| WDA cert expired | `baremobile ios resign` or `baremobile setup` option 4 |
| Port 8100 in use | `fuser -k 8100/tcp` or `baremobile ios teardown` |
| Tunnel auth popup doesn't appear | Run `pkexec echo test` to verify pkexec works |
| WDA not reachable after setup | Verify: `curl http://localhost:8100/status` |

### Files

```
src/ios.js              # iOS page object (WDA over HTTP)
src/usbmux.js           # Node.js usbmuxd client for USB connection
src/ios-cert.js         # WDA cert expiry tracking
src/setup.js            # Unified setup wizard (Android + iOS)
.wda/AltServer          # AltServer-Linux binary (signing)
.wda/WebDriverAgent.ipa # WDA app to install on device
```

### iOS tests

**Unit tests (no device needed):**

| File | Tests | What it covers |
|------|-------|----------------|
| `test/unit/ios.test.js` | 47 | Module exports (2), translateWda node shape (13), prune+formatTree pipeline (5), CLASS_MAP (2), accessible attr refs (5), screenshotToPoint (3), coordinates (2), StatusBar/dedup (5), keyboard stripping (3), Unicode noise (3), file path stripping (3), findByText (1) |
| `test/unit/usbmux.test.js` | 4 | listDevices plist parsing (1), connectDevice binary packet (1), forward TCP lifecycle (1), protocol header format (1) |
| `test/unit/setup.test.js` | 12 | detectHost, parseTunnelOutput, which, parseWdaBundleFromJson |

**Real-device tests (requires iPhone + WDA running):**

| File | Tests | What it covers |
|------|-------|----------------|
| `ios/test-wda.js` | 15 | snapshot, screenshot, launch Settings, tap Cell, back, scroll, swipe, home, waitForText, type, longPress, tapXY, press home/volumeup/volumedown |

```bash
# Run real-device tests
baremobile setup             # option 3: Start iPhone WDA server
node ios/test-wda.js         # 15 tests against real iPhone
baremobile ios teardown
```

### iOS E2E flows (manually verified)

| Flow | Steps |
|------|-------|
| Launch Settings + read screen | launch → snapshot → verify Wi-Fi/Bluetooth/General visible |
| Tap element by ref | snapshot → find Cell → tap(ref) → verify navigation |
| Type in search field | find SearchField → type(ref, "wifi") → verify results |
| Back navigation | tap into sub-page → back() → verify return |
| Scroll long lists | Settings → scroll(ref, 'down') → verify new items |
| Screenshot capture | screenshot() → verify PNG magic bytes |
| Home button | home() → verify returns to launcher |
| Airplane Mode toggle | Settings → tap switch → verify state change |

**MCP/CLI verification (manual, requires iPhone + WDA):**

| Step | Command | Expected |
|------|---------|----------|
| iOS session via CLI | `baremobile open --platform=ios` | Session started with platform ios |
| iOS snapshot | `baremobile snapshot` | YAML tree with iOS elements (Cell, NavBar) |
| iOS close | `baremobile close` | Session closed |
| MCP dual-platform | `snapshot({platform: 'ios'})` via MCP | iOS tree; `snapshot()` → Android tree |
| Cert warning | Delete `/tmp/baremobile-ios-signed`, call iOS MCP snapshot | Warning prepended |
| Setup wizard | `baremobile setup` → pick iOS | Guides through all steps |
| Resign | `baremobile ios resign` | Prompts for creds, signs, records timestamp |

---

## Writing new tests

**Unit tests:** Pure function in, value out. No device, no I/O. Import from `src/`, assert results.

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid } from '../../src/interact.js';

describe('buildGrid', () => {
  it('creates 10 columns', () => {
    const g = buildGrid(1080, 2400);
    assert.strictEqual(g.cols, 10);
  });
});
```

**Integration tests:** Need `connect()` → page object. Use the skip pattern for CI:

```js
import { listDevices } from '../../src/adb.js';

let hasDevice = false;
try {
  const devices = await listDevices();
  hasDevice = devices.length > 0;
} catch { hasDevice = false; }

describe('my test', { skip: !hasDevice && 'No ADB device' }, () => {
  // tests here
});
```

**Key rules:**
- Use `node:test` and `node:assert/strict` only — no test frameworks
- Integration tests must auto-skip without a device (top-level await for detection)
- Don't cache refs across snapshots — they reset every call
- Add settle delays after actions (`await new Promise(r => setTimeout(r, 500))`) before snapshotting

### Cross-platform testing (Android + iOS)

Both platforms use the same page-object pattern: `connect()` → `snapshot()` → `tap(ref)`.

| | Android | iOS |
|---|---|---|
| Transport | ADB (`child_process.execFile`) | WDA HTTP (`fetch()`) |
| Import | `import { connect } from 'baremobile'` | `import { connect } from 'baremobile/src/ios.js'` |
| App IDs | Package: `com.android.settings` | Bundle: `com.apple.Preferences` |
| Setup | `adb devices` | `baremobile setup` (option 3) |
| Unit tests | `node --test test/unit/*.test.js` | Same (includes `ios.test.js`) |
| Device tests | `node --test test/integration/*.test.js` | `node ios/test-wda.js` |
| Snapshot format | Hierarchical YAML tree | Hierarchical YAML tree (shared pipeline) |
| back() | ADB keypress | Find back button or swipe gesture |
