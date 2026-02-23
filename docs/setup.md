# Development Environment Setup

## Prerequisites

### System Packages (Fedora)

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

### 32-bit Libraries (only if emulator fails to launch)

```bash
sudo dnf install -y \
  glibc.i686 \
  libstdc++.i686 \
  libX11.i686 \
  libXrender.i686 \
  libXrandr.i686 \
  pulseaudio-libs.i686
```

## Android SDK

### Install cmdline-tools

```bash
export ANDROID_HOME="$HOME/android-sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools"

# Download (check https://developer.android.com/studio#command-line-tools-only for latest)
cd /tmp
curl -O https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip
unzip -qo commandlinetools-linux-14742923_latest.zip
mv cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
```

### Set PATH

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
export ANDROID_HOME="$HOME/android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export PATH="$ANDROID_HOME/emulator:$PATH"
```

### Install SDK Components

```bash
# Accept licenses
yes | sdkmanager --licenses

# Install tools + system image
sdkmanager "platform-tools" "emulator" \
  "system-images;android-35;google_apis_playstore;x86_64" \
  "platforms;android-35"
```

### Create AVD

```bash
avdmanager create avd \
  --name "baremobile-test" \
  --package "system-images;android-35;google_apis_playstore;x86_64" \
  --device "pixel_9"
```

### Launch Emulator

```bash
# With window
emulator -avd baremobile-test -gpu host &

# Headless (CI)
emulator -avd baremobile-test -no-window -no-audio &

# Wait for boot
adb wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'
```

## Verify

```bash
adb devices                          # should show emulator-5554
adb shell uiautomator dump /dev/tty  # should return XML tree
node poc.js snapshot                 # should show YAML with refs
```

## Quick Reference

| Component | Version | Purpose |
|---|---|---|
| Node.js | >= 22 | Runtime |
| Java | >= 17 | sdkmanager/avdmanager |
| Android cmdline-tools | latest | sdkmanager, avdmanager |
| platform-tools | latest | adb |
| emulator | latest | Android emulator |
| system-images;android-35;google_apis_playstore;x86_64 | latest | Emulator OS image |
| KVM | kernel module | Hardware acceleration |
