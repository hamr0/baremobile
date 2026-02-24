# Development Environment Setup

All modules share Node.js >= 22. Each module adds its own dependencies.

## Shared

| Dependency | Version | Install (Fedora) |
|-----------|---------|-----------------|
| **Node.js** | >= 22 | `dnf install nodejs` or [nvm](https://github.com/nvm-sh/nvm) |

---

## Core ADB (screen control from host)

### System packages (Fedora)

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

### 32-bit libraries (only if emulator fails to launch)

```bash
sudo dnf install -y \
  glibc.i686 \
  libstdc++.i686 \
  libX11.i686 \
  libXrender.i686 \
  libXrandr.i686 \
  pulseaudio-libs.i686
```

### Android SDK

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

### SDK components + emulator

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

### Verify

```bash
adb devices                          # should show emulator-5554
adb shell uiautomator dump /dev/tty  # should return XML tree
node --test test/unit/*.test.js      # unit tests (no device needed)
node --test test/integration/*.test.js  # integration tests (needs emulator)
```

### Package summary

| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | >= 22 | Runtime |
| Java | >= 17 | sdkmanager/avdmanager |
| Android cmdline-tools | latest | sdkmanager, avdmanager |
| platform-tools | latest | adb |
| emulator | latest | Android emulator |
| system-images;android-35;google_apis_playstore;x86_64 | latest | Emulator OS image |
| KVM | kernel module | Hardware acceleration |

---

## Termux ADB (on-device screen control)

No host-side setup needed beyond Core ADB. Testing uses the same emulator.

### Emulator testing setup

Termux ADB is tested via POC scripts that simulate the Termux-to-localhost-ADB path:

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

### On real device (inside Termux)

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

### Package summary

| Component | Where | Purpose |
|-----------|-------|---------|
| android-tools | Termux (`pkg install`) | adb client inside Termux |
| nodejs-lts | Termux (`pkg install`) | Node.js runtime inside Termux |
| Wireless debugging | Android 11+ setting | localhost ADB access |

---

## Termux:API (direct Android APIs, no ADB)

### Emulator testing setup

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

### Validate (inside Termux)

```bash
# Bash POC — raw CLI commands
termux-battery-status          # should return JSON
termux-clipboard-set "test"
termux-clipboard-get           # should return "test"
termux-volume                  # should list stream volumes
termux-wifi-connectioninfo     # should return JSON
termux-vibrate                 # device should vibrate

# Node.js POC — validates our execFile + JSON.parse pattern
node -e "
const { execFile } = require('child_process');
execFile('termux-battery-status', (err, stdout) => {
  console.log(JSON.parse(stdout));
});
"
```

### Not testable on emulator (needs real device)

| Command | Why |
|---------|-----|
| `termux-sms-send` / `termux-sms-list` | No SIM card |
| `termux-telephony-call` | No SIM card |
| `termux-location` | No GPS hardware |
| `termux-camera-photo` | No camera hardware |
| `termux-contact-list` | No contacts on fresh emulator |

### Package summary

| Component | Where | Purpose |
|-----------|-------|---------|
| Termux APK | F-Droid / sideload | Terminal emulator for Android |
| Termux:API APK | F-Droid / sideload | Android API bridge addon |
| termux-api | Termux (`pkg install`) | CLI tools for Termux:API |
| nodejs-lts | Termux (`pkg install`) | Node.js runtime inside Termux |

---

## iOS

> See [00-context/ios-exploration.md](../00-context/ios-exploration.md) for full research and architecture analysis.

### System packages (Fedora)

```bash
# Python 3.12 (NOT 3.14 — native deps fail to compile on 3.14)
sudo dnf install -y python3.12

# pymobiledevice3 — iOS device bridge (pure Python, works on Linux)
python3.12 -m pip install --user pymobiledevice3

# usbmuxd — USB/WiFi multiplexer daemon for iOS
sudo dnf install -y usbmuxd

# BlueZ — BLE HID emulation (usually pre-installed on Fedora)
# Verify: bluetoothctl --version (need >= 5.56)
# Set ControllerMode = le in /etc/bluetooth/main.conf for BLE peripheral mode
```

### iPhone setup (one-time, USB required)

```bash
# 1. Connect iPhone via USB, tap "Trust This Computer" on phone
python3.12 -m pymobiledevice3 usbmux list   # verify connection

# 2. Run the setup script (reveals dev mode, enables WiFi, pairs for remote access)
./scripts/ios-tunnel.sh setup
# Then on iPhone: Settings > Privacy & Security > Developer Mode > ON > restart

# 3. Start bridge (pick one)
./scripts/ios-tunnel.sh              # USB tunnel + BLE HID
./scripts/ios-tunnel.sh --wifi       # WiFi tunnel + BLE HID (cable-free)
./scripts/ios-tunnel.sh --no-ble     # tunnel only, no BLE

# 4. Verify
python3.12 scripts/ios-ax.py --rsd $(cat /tmp/ios-rsd-address) dump   # accessibility dump
npm run test:ios                     # full test suite
```

#### Manual tunnel (without setup script)

```bash
# USB tunnel
sudo PYTHONPATH=$HOME/.local/lib/python3.12/site-packages \
  python3.12 -m pymobiledevice3 lockdown start-tunnel

# WiFi tunnel (after remote pair)
sudo PYTHONPATH=$HOME/.local/lib/python3.12/site-packages \
  python3.12 -m pymobiledevice3 remote start-tunnel --connection-type wifi --protocol tcp
```

### BLE HID setup

BLE HID allows Linux to present as a Bluetooth keyboard+mouse to the iPhone. Used for text input and tap-at-coordinates via AssistiveTouch.

#### BlueZ configuration

```ini
# /etc/bluetooth/main.conf
[General]
ControllerMode = le
DisablePlugins = input
```

Then restart: `sudo systemctl restart bluetooth`

- `ControllerMode = le` — LE-only mode, prevents duplicate Classic BT entry on iPhone
- `DisablePlugins = input` — prevents BlueZ from claiming our GATT HID service as local input

#### Python dependencies (system Python 3.14)

```bash
# dbus-python and PyGObject must be system packages (not pip)
sudo dnf install python3-dbus python3-gobject
```

BLE HID uses system Python 3.14 (not 3.12) because dbus-python and PyGObject are system packages that don't install cleanly via pip.

#### iPhone pairing (one-time)

1. Enable AssistiveTouch: Settings > Accessibility > Touch > AssistiveTouch > ON
2. Enable "Pointer Devices" under AssistiveTouch
3. Run the BLE HID GATT server: `python3 test/ios/ble-hid-poc.py`
4. On iPhone: Settings > Bluetooth > tap "baremobile" to pair
5. Accept the pairing code displayed on both devices

After pairing, the iPhone reconnects automatically when the GATT server starts.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `FileNotFoundError` on usbmux socket | usbmuxd not running → `sudo usbmuxd -f -v` |
| `Unable to connect to Tunneld` | Start tunneld in separate terminal (step 3) |
| `Cannot enable developer-mode when passcode is set` | Use `reveal-developer-mode` instead, toggle manually |
| `No module named 'pymobiledevice3'` under sudo | Add `PYTHONPATH=$HOME/.local/lib/python3.12/site-packages` |
| Developer Mode not visible in Settings | Run `amfi reveal-developer-mode` first, force-close Settings, reopen |
| Python 3.14 build failures | Use Python 3.12 for pymobiledevice3 — native deps (lzfse) don't compile on 3.14 yet |
| Two "baremobile" entries on iPhone | `ControllerMode = le` not set — Classic BT + LE both advertising |
| BLE HID pairs but no input reaches iPhone | Check `KeyboardDisplay` agent capability — `NoInputNoOutput` is silently refused |
| Keyboard drops when mouse connects | LED Output Report Reference must have Report ID 1 (not 0), Appearance must be `0x03C0` (Generic HID) |
| Mouse moves tiny amount | iOS clamps single-report movement — send rapid small-step reports (10 units, 8ms interval) |
| Duplicate BLE pairing entries on iPhone | Remove old entry: iPhone Settings > Bluetooth > (i) > Forget This Device, then re-pair |

### Package summary

| Component | Version | Purpose |
|-----------|---------|---------|
| Python | 3.12 (not 3.14) | pymobiledevice3 host |
| Python | 3.14 (system) | BLE HID — dbus-python/PyGObject are system packages |
| pymobiledevice3 | >= 7.7.0 | iOS device bridge (screenshots, app lifecycle, device mgmt) |
| usbmuxd | any | USB/WiFi mux daemon for iOS |
| BlueZ | >= 5.56 | BLE HID keyboard/mouse emulation (`ControllerMode = le`, `DisablePlugins = input`) |
| dbus-python | system | Python D-Bus bindings for BlueZ GATT API |
| PyGObject (gi) | system | GLib main loop for async BLE event handling |

### Running iOS tests

```bash
# Validate prerequisites (no tunnel needed)
npm run ios:check

# Start bridge first (writes RSD address to /tmp/ios-rsd-address)
./scripts/ios-tunnel.sh --wifi    # or without --wifi for USB

# Run iOS tests
npm run test:ios

# Or set RSD manually
RSD_ADDRESS="fd07:add5:d1db::1 62584" npm run test:ios
```

> **RSD_ADDRESS** format: `"host port"` (space-separated, IPv6 safe).
> The tunnel script writes this automatically to `/tmp/ios-rsd-address`.

### Test files

```
test/unit/ios.test.js         # Unit tests (21 tests): formatSnapshot, caption parsing, RSD, BLE commands
test/ios/
  check-prerequisites.js      # prerequisite validator: python, pymobiledevice3, usbmuxd
  ios-connect.test.js         # Integration (7 tests): snapshot, tap(ref), waitForText, full loop
  screenshot.test.js          # pymobiledevice3 tests (8 tests): screenshot, app lifecycle, latency
  ble-hid-poc.py              # BLE HID GATT server (Python, BlueZ D-Bus)
  ble-hid.test.js             # BLE HID tests: adapter, keyboard, mouse
  integration.test.js         # Legacy integration (6 tests): screenshot → BLE tap → type → verify

scripts/
  ios-tunnel.sh               # Bridge script: USB/WiFi tunnel + BLE HID
  ios-ax.py                   # Accessibility helper: dump elements + focus navigation
```
