---
type: reference
title: Agent Capabilities and Limitations
status: stable
sources: [docs/archive/prd.md]
---

# Agent Capabilities and Limitations

This page summarizes what an agent driving baremobile can do unaided, where it still needs
human/vision help, and the constraints that hold regardless of workaround (prd.md:568-619, prd.md:620-635).

## Autonomous screen control (Core ADB + Termux ADB)

The core ADB layer neutralizes most of the obstacles that make raw Android accessibility trees
hard for an agent to act on (prd.md:570-587):

- **Tree size and noise** — 4-step pruning collapses wrappers, drops empty nodes, and dedups
  repeats, so the agent sees content rather than structure (prd.md:574).
- **Widget vocabulary** — 27 class-to-role mappings turn `androidx.appcompat.widget.AppCompatButton`
  into plain `Button` (prd.md:575).
- **Element targeting** — every interactive node gets a `[ref=N]`; the agent picks a ref and the
  library resolves the on-screen bounds itself, including for multi-step forms where fresh refs
  are issued each snapshot (prd.md:578-579).
- **State visibility** — disabled, checked, selected, and focused states render directly as
  `[disabled]`, `[checked]`, `[selected]`, `[focused]` (prd.md:581).
- **Interaction primitives** — scrollable containers get refs so `scroll(ref, 'down')` computes
  the swipe within bounds; `longPress(ref)` opens context menus, which then appear in the next
  snapshot; confirmation dialogs simply show up in the tree with their buttons for the agent to
  read and tap (prd.md:580, 582-583).
- **Platform quirks worked around** — `input text` is broken on API 35+, handled via word-by-word
  typing plus `KEYCODE_SPACE` with shell-escaping of special characters; the uiautomator dump is
  also broken on API 35+, worked around by dumping to a temp file and reading it back with
  `exec-out`, which doubles as the fix for binary output corruption on screenshots and XML
  (prd.md:576-577, 584).
- **Fallback and scale** — when the ARIA/accessibility tree fails outright, `screenshot()` plus
  `tapXY(x, y)` or `tapGrid('C5')` provides a vision-based fallback; every ADB call threads
  `-s serial` so multi-device setups work; and the XML parser decodes all 5 XML entities so
  snapshots render text like `Network & internet` correctly (prd.md:585-587).

### Termux ADB additional capabilities

Running over Termux ADB adds device-discovery conveniences on top of the above: automatic
localhost device discovery via `connect({termux: true})`, which detects `localhost:PORT`, and
wireless debugging pairing through the `adbPair()` and `adbConnect()` helpers (prd.md:589,
593-594).

### Termux:API — direct Android APIs

Where Termux:API is available, the agent can bypass the UI entirely and call Android APIs
directly (prd.md:596-606):

| Capability | Interface |
|---|---|
| SMS send/receive | `smsSend()` / `smsList()` — no need to open the Messages app |
| Phone calls | `call(number)` via the telephony API |
| Location | `location({provider})` for GPS/network/passive |
| Camera | `cameraPhoto(file, {camera})` for front/back capture |
| Clipboard | `clipboardGet()` / `clipboardSet()` |
| Device info | `batteryStatus()`, `volumeGet/Set()`, `wifiInfo()` |
| Hardware | `torch(on)`, `vibrate({duration})` |

(prd.md:600-606)

## Where the agent still needs help

Some obstacles have no programmatic solution yet, or require the agent to fall back to acting
through the UI or a vision model rather than through structured control (prd.md:608-616):

- **Login / auth** — app tokens live in the hardware Keystore and can't be extracted, so the
  agent has to log in through the UI like a person would (prd.md:612).
- **WebView content** — the uiautomator tree is empty or shallow inside WebViews; a CDP bridge is
  planned for Phase 6 but isn't available yet (prd.md:613).
- **CAPTCHAs** — there is no programmatic bypass; the agent must use a vision model or avoid the
  flow (prd.md:614).
- **Multi-touch** — `adb input` only supports a single touch point; `sendevent` support is planned
  for Phase 7 (prd.md:615).
- **Screen control via Termux:API** — Termux:API is direct-API-access only and does not expose
  screen control, so it must be paired with Termux ADB mode for UI-driving tasks (prd.md:616).

## Known limitations

These hold independent of any workaround above, and are worth designing agent flows around
(prd.md:620-632):

- **Snapshot latency** — a uiautomator dump takes 1-5 seconds depending on the device, slower on
  emulators (prd.md:624).
- **WebView content** — trees inside WebViews are empty or shallow, and Flutter apps can crash
  uiautomator with a `StackOverflowError` (prd.md:625).
- **Auth/tokens** — app tokens cannot be read on non-rooted devices (prd.md:626).
- **Refs are unstable** — ref numbers reset on every snapshot and must never be cached across
  snapshots (prd.md:627).
- **No parallel snapshots** — the uiautomator dump holds a global lock, so only one snapshot at a
  time is possible per device (prd.md:628).
- **Text input on API 35+** — `input text` with spaces is broken; the word-by-word workaround is
  implemented but the underlying platform bug remains (prd.md:629).
- **No multi-touch** — only single-point gestures are possible via `adb shell input` (prd.md:630).
- **iOS WiFi tunnel** — WONTFIX on Linux; it requires Xcode-based WiFi pairing, so USB is required
  for iOS control (prd.md:631).
- **iOS cert expiry** — a free Apple ID issues only a 7-day certificate, so WDA must be re-signed
  weekly (prd.md:632).
