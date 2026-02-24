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

## iOS (research/spike — not yet built)

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

### iPhone setup (one-time)

```bash
# 1. Connect iPhone via USB, tap "Trust This Computer" on phone
python3.12 -m pymobiledevice3 usbmux list   # verify connection

# 2. Reveal Developer Mode toggle (iOS 16+ hides it by default)
python3.12 -m pymobiledevice3 amfi reveal-developer-mode
# Then on iPhone: Settings > Privacy & Security > Developer Mode > ON > restart

# 3. Start tunnel (iOS 17+ requires this, must stay running)
sudo PYTHONPATH=$HOME/.local/lib/python3.12/site-packages \
  python3.12 -m pymobiledevice3 remote tunneld

# 4. Mount developer disk image (one-time per boot)
python3.12 -m pymobiledevice3 mounter auto-mount

# 5. Take a screenshot to verify everything works
python3.12 -m pymobiledevice3 developer dvt screenshot /tmp/iphone-test.png
```

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `FileNotFoundError` on usbmux socket | usbmuxd not running → `sudo usbmuxd -f -v` |
| `Unable to connect to Tunneld` | Start tunneld in separate terminal (step 3) |
| `Cannot enable developer-mode when passcode is set` | Use `reveal-developer-mode` instead, toggle manually |
| `No module named 'pymobiledevice3'` under sudo | Add `PYTHONPATH=$HOME/.local/lib/python3.12/site-packages` |
| Developer Mode not visible in Settings | Run `amfi reveal-developer-mode` first, force-close Settings, reopen |
| Python 3.14 build failures | Use Python 3.12 — native deps (lzfse) don't compile on 3.14 yet |

### Package summary

| Component | Version | Purpose |
|-----------|---------|---------|
| Python | 3.12 (not 3.14) | pymobiledevice3 host |
| pymobiledevice3 | >= 7.7.0 | iOS device bridge (screenshots, app lifecycle, device mgmt) |
| usbmuxd | any | USB/WiFi mux daemon for iOS |
| BlueZ | >= 5.56 | BLE HID keyboard/mouse emulation (future) |

### Planned test structure

```
test/ios/
  check-prerequisites.js   # validate python, pymobiledevice3, usbmuxd, device connection
  screenshot.test.js        # spike: detect device, lockdown info, dev mode, screenshot
```

```bash
npm run ios:check    # validate prerequisites + iPhone connection
npm run test:ios     # iOS spike tests (requires iPhone)
```
