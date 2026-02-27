# CLI Guide

Complete reference for `baremobile` — the command-line interface to baremobile.

```bash
npx baremobile <command> [options]
# or if installed globally / via npm link:
baremobile <command> [options]
```

---

## Global Options

| Flag | Description |
|------|-------------|
| `--platform=android\|ios` | Target platform (default: `android`) |
| `--json` | Machine-readable JSON output (one line per command) |

---

## Session Lifecycle

A session starts a background daemon that holds an ADB or WDA connection. All subsequent commands talk to this daemon.

### `open`

Start a new session daemon.

```bash
baremobile open                         # auto-detect device
baremobile open --device=emulator-5554  # specific device
baremobile open --platform=ios          # iOS (WDA) session
```

Output: `Session started` (or JSON: `{"ok":true,"pid":1234,"port":40049,"outputDir":"..."}`)

Creates `.baremobile/session.json` with daemon port and pid. Only one session per directory.

### `status`

Check if a session is running.

```bash
baremobile status
# Session running (pid: 1234, port: 40049)
```

Exits non-zero if no session found.

### `close`

Shut down the daemon and clean up.

```bash
baremobile close
# Session closed
```

Removes `session.json`. Does **not** kill iOS tunnel/WDA — use `ios teardown` for that.

---

## Screen Commands

### `snapshot`

Capture the accessibility tree as pruned YAML with `[ref=N]` markers.

```bash
baremobile snapshot
# /path/.baremobile/screen-2026-02-27T10-15-00.yml
```

Writes to `.baremobile/screen-TIMESTAMP.yml`. Refs are interactive elements — use them with `tap`, `type`, `scroll`.

### `screenshot`

Capture a PNG screenshot.

```bash
baremobile screenshot
# /path/.baremobile/screenshot-2026-02-27T10-15-05.png
```

### `grid`

Get screen grid info for vision-based tapping. *Android only.*

```bash
baremobile grid
# Screen: 1080x2400, Grid: 10 cols (A-J) x 22 rows ...
```

Use with `tap-grid` for coordinate-based interaction when the accessibility tree fails (Flutter, WebViews).

---

## Interaction Commands

All interaction commands print `ok` on success. Take a snapshot after each action to observe the result.

### `tap`

Tap an interactive element by ref number.

```bash
baremobile tap 5
```

### `tap-xy`

Tap by raw pixel coordinates. *Android only.*

```bash
baremobile tap-xy 540 1200
```

### `tap-grid`

Tap by grid cell label (e.g. `C5`). *Android only.*

```bash
baremobile tap-grid C5
```

### `type`

Type text into an element. Taps to focus first if needed.

```bash
baremobile type 3 "hello world"
baremobile type 3 "new text" --clear    # clear field first
```

### `press`

Press a hardware/software key.

```bash
baremobile press enter
baremobile press back
baremobile press home
```

**Android keys:** `back`, `home`, `enter`, `delete`, `tab`, `escape`, `up`, `down`, `left`, `right`, `space`, `power`, `volup`, `voldown`, `recent`

**iOS keys:** `home`, `volumeup`, `volumedown`

### `scroll`

Scroll within a scrollable element.

```bash
baremobile scroll 1 down
baremobile scroll 1 up
```

Directions: `up`, `down`, `left`, `right`

### `swipe`

Raw swipe between two coordinates.

```bash
baremobile swipe 540 1800 540 800           # swipe up
baremobile swipe 540 800 540 1800 --duration=500  # slow swipe down
```

### `long-press`

Long-press an element.

```bash
baremobile long-press 3
```

### `launch`

Launch an app by package name (Android) or bundle ID (iOS).

```bash
baremobile launch com.android.settings       # Android
baremobile launch com.apple.Preferences --platform=ios  # iOS
```

### `intent`

Deep navigation via Android intents. *Android only.*

```bash
baremobile intent android.settings.BLUETOOTH_SETTINGS
baremobile intent android.intent.action.VIEW --extra-string url=https://example.com
```

### `back`

Navigate back (Android back button, iOS back gesture/button).

```bash
baremobile back
```

### `home`

Go to home screen.

```bash
baremobile home
```

---

## Waiting Commands

Poll until a condition is met. Useful for waiting for screen transitions.

### `wait-text`

Wait until specific text appears on screen.

```bash
baremobile wait-text "Bluetooth"              # default 10s timeout
baremobile wait-text "Connected" --timeout=15000
```

### `wait-state`

Wait until an element reaches a specific state.

```bash
baremobile wait-state 4 checked --timeout=5000
baremobile wait-state 7 enabled
```

States: `enabled`, `disabled`, `checked`, `unchecked`, `focused`, `selected`

---

## Logging

### `logcat`

Capture Android logcat entries. *Android only.*

```bash
baremobile logcat                             # all entries since session start
baremobile logcat --filter=ActivityManager    # filter by tag
baremobile logcat --clear                     # clear buffer first
```

Writes to `.baremobile/logcat-TIMESTAMP.json` — array of `{tag, level, message, timestamp}` objects.

---

## Setup & iOS Management

### `setup`

Interactive setup wizard. Detects OS and package manager, checks prerequisites, guides through remaining steps.

```bash
baremobile setup
```

**Menu options:**

| Option | Description |
|--------|-------------|
| **1. Android setup** | Check ADB, detect devices, verify connection |
| **2. iOS from scratch** | Full 9-step guided install (see below) |
| **3. iOS start WDA server** | 5 sub-steps — for when WDA is already installed |
| **4. iOS renew cert** | Re-sign WDA via AltServer (4 steps) |

#### iOS from scratch (option 2) — 9 steps

| Step | What |
|------|------|
| 1 | Detect host OS (Linux/macOS/WSL + package manager) |
| 2 | Check pymobiledevice3 (with install guidance per OS) |
| 3 | Check AltServer (`.wda/AltServer`) |
| 4 | Check libdns_sd / mDNS |
| 5 | Check USB device (prompts to connect if missing) |
| 6 | Sign & install WDA via AltServer (Apple ID + 2FA, anisette fallback) |
| 7 | Device settings checklist: Developer Mode, Trust profile, UI Automation |
| 8 | Start WDA server (tunnel + DDI mount + WDA launch + port forward) |
| 9 | Final verification (`/status` health check) |

#### iOS start WDA (option 3) — 5 sub-steps

For when WDA is already installed and device settings are configured.

| Sub-step | What |
|----------|------|
| a | Check USB device |
| b | Start tunnel (pkexec on Linux, sudo on macOS/WSL) |
| c | Mount Developer Disk Image |
| d | Launch WDA via XCUITestService |
| e | Port forward + verify `/status` |

#### iOS prerequisites

| Requirement | Linux (dnf) | Linux (apt) | macOS |
|-------------|-------------|-------------|-------|
| pymobiledevice3 | `pip install --user pymobiledevice3` | same | same or `brew install` |
| AltServer | [GitHub release](https://github.com/NyaMisty/AltServer-Linux/releases) → `.wda/AltServer` | same | `brew install altserver` |
| WebDriverAgent.ipa | Place at `.wda/WebDriverAgent.ipa` | same | same |
| libdns_sd | `dnf install avahi-compat-libdns_sd-devel` | `apt install libavahi-compat-libdnssd-dev` | built-in |
| Apple ID | Free account (7-day cert, re-sign weekly) | same | same |

#### iPhone device settings (one-time)

1. **Developer Mode**: Settings > Privacy & Security > Developer Mode > ON (requires restart, toggle appears after first dev app install)
2. **Trust profile**: Settings > General > VPN & Device Management > tap your Apple ID > Trust
3. **UI Automation**: Settings > Developer > Enable UI Automation > ON

#### Environment variables

| Variable | Purpose |
|----------|---------|
| `ALTSERVER_ANISETTE_SERVER` | Override anisette server URL. Default server (`armconverter.com`) sometimes 502s; setup auto-retries with `ani.sidestore.io` as fallback. |

### `ios resign`

Re-sign WDA cert interactively. Same as setup option 4.

```bash
baremobile ios resign
# Prompts for Apple ID, password, 2FA code
# Records signing timestamp for expiry tracking
```

Free Apple ID certs expire every 7 days. The MCP server warns when cert is >6 days old.

### `ios teardown`

Kill all iOS bridge processes (tunnel, WDA, port forward).

```bash
baremobile ios teardown
```

---

## MCP Server

### `mcp`

Start the MCP server (JSON-RPC 2.0 over stdio). Used by Claude Code and other MCP clients.

```bash
baremobile mcp
```

Add to Claude Code:
```bash
claude mcp add baremobile -- node /path/to/baremobile/mcp-server.js
```

10 tools available, all accept optional `platform: "ios"`:
`snapshot`, `tap`, `type`, `press`, `scroll`, `swipe`, `long_press`, `launch`, `screenshot`, `back`

---

## JSON Mode

Add `--json` to any command for machine-readable output. Every response is one JSON line with `ok: true|false`.

```bash
baremobile open --json
# {"ok":true,"pid":1234,"port":40049,"outputDir":"/path/.baremobile"}

baremobile snapshot --json
# {"ok":true,"file":"/path/.baremobile/screen-2026-02-27T10-15-00.yml"}

baremobile tap 4 --json
# {"ok":true}

baremobile logcat --json
# {"ok":true,"file":"/path/.baremobile/logcat-2026-02-27T10-16-00.json","count":523}

baremobile status --json
# {"ok":false,"error":"No session found."}
```

File-producing commands include `file`. Errors include `error`. Agents parse one line per invocation.

---

## Output Conventions

All file output goes to `.baremobile/` in the current working directory:

| File | Source |
|------|--------|
| `session.json` | `open` — daemon port + pid |
| `screen-TIMESTAMP.yml` | `snapshot` — accessibility tree |
| `screenshot-TIMESTAMP.png` | `screenshot` — PNG image |
| `logcat-TIMESTAMP.json` | `logcat` — log entries array |

Action commands (`tap`, `type`, `press`, etc.) print `ok` to stdout.
File commands (`snapshot`, `screenshot`, `logcat`) print the file path to stdout.
Errors go to stderr with non-zero exit code.

---

## Workflow Examples

### Basic Android automation

```bash
baremobile open
baremobile launch com.android.settings
sleep 2
baremobile snapshot          # see what's on screen
baremobile tap 4             # tap an element
baremobile snapshot          # observe result
baremobile close
```

### iOS QA session

```bash
baremobile setup             # option 3: start WDA server
baremobile open --platform=ios
baremobile launch com.apple.Preferences
sleep 2
baremobile snapshot
baremobile tap 2
baremobile snapshot
baremobile close
baremobile ios teardown      # kill tunnel/WDA
```

### Agent scripting with JSON mode

```bash
baremobile open --json
baremobile launch com.android.chrome --json
sleep 3
FILE=$(baremobile snapshot --json | jq -r .file)
# Parse YAML, find search field ref, type query
baremobile type 5 "weather today" --json
baremobile press enter --json
sleep 2
baremobile snapshot --json
baremobile close --json
```

### Search and interact

```bash
baremobile open
baremobile launch com.android.settings
sleep 2
# Find search field in snapshot, type into it
baremobile snapshot
baremobile type 2 "bluetooth"
baremobile press enter
sleep 1
baremobile snapshot
# Find Bluetooth toggle, tap it
baremobile tap 5
baremobile wait-text "Connected" --timeout=10000
baremobile close
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Daemon failed to start within 15s` | No device connected. Run `adb devices` to check. |
| `No active session` | Run `baremobile open` first. |
| `Cannot reach localhost:8100` | iOS tunnel or WDA not running. Run `baremobile setup` (option 3). |
| `Tunnel requires elevated access — authentication was cancelled` | Re-run setup and authenticate the pkexec popup. |
| `AltServer failed. Double-check email and password.` | Wrong Apple ID credentials. Verify and retry. |
| `Default anisette server failed (502)` | Apple auth server issue. Setup auto-retries with fallback. Set `ALTSERVER_ANISETTE_SERVER` to override. |
| `WDA launch blocked — developer profile not trusted` | Settings > General > VPN & Device Management > Trust your Apple ID. |
| `Developer Mode not visible` | Install a dev app first (WDA), then the toggle appears in Settings > Privacy & Security. |
| `Port 8100 in use` | `fuser -k 8100/tcp` or `baremobile ios teardown`. |
| Session won't exit cleanly | `baremobile close` then `baremobile ios teardown` if iOS. |
