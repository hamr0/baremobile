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

## iOS (WDA-based, QA only — USB required)

> See [00-context/ios-exploration.md](../00-context/ios-exploration.md) for full research and architecture analysis.

### Quick Start

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

### Package summary

| Component | Version | Purpose |
|-----------|---------|---------|
| pymobiledevice3 | >= 7.7.0 | Setup only — tunnel, DDI mount, WDA launch |
| usbmuxd | any | USB mux daemon for iOS device communication |
| AltServer-Linux | latest | Signing WDA with free Apple ID |

### Test files

```
test/unit/ios.test.js         # Unit tests: translateWda, node shape, nav helpers
test/unit/setup.test.js       # Unit tests: detectHost, parseTunnelOutput, which, parseWdaBundleFromJson
```
