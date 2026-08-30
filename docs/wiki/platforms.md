---
type: reference
title: Platform Support - Android and iOS
status: stable
contract: docs/product/prd.md
---

# Platform Support

baremobile controls Android and iOS devices through two different transports that
converge on the same snapshot/tap pipeline.

## Android

All three Android modes share the same `adb.js` transport (prd.md:425):

| Mode | Where it runs | Serial | Setup |
|------|--------------|--------|-------|
| Host ADB | Host machine | USB serial, IP:port, emulator-* | USB debugging or `adb tcpip` |
| Termux ADB | On the phone | `localhost:PORT` | Wireless debugging + `adb pair` + `adb connect` |
| Termux:API | On the phone | N/A (no ADB) | `pkg install termux-api` |

(prd.md:427-431)

Host ADB is the primary mode for QA, testing, and development. Termux ADB enables
autonomous on-device agents using the same pipeline with a different serial. Termux:API
gives direct access to Android APIs (SMS, calls, location) without controlling the
screen (prd.md:433).

Android requirements: Node.js >= 22, `adb` on PATH (from Android SDK platform-tools),
and USB debugging enabled on the device (prd.md:435-438).

## iOS

iOS support is WDA-based (WebDriverAgent) and requires USB. It follows the same
`snapshot() -> tap(ref)` pattern as Android (prd.md:442). `translateWda()` converts
WDA's `/source` XML into the Android node shape, after which the shared `prune()` and
`formatTree()` functions produce identical YAML output. The runtime itself is pure
`fetch()`, with zero Python dependency (prd.md:444).

iOS requirements: an iPhone with Developer Mode enabled; WDA signed and installed
(free Apple ID, 7-day certificate, re-signed weekly via `baremobile ios resign`);
pymobiledevice3 (Python 3.12) for setup only -- tunnel, DDI mount, and WDA launch; and
a USB cable, which is mandatory since a WiFi tunnel needs a Mac/Xcode and is WONTFIX
on Linux (prd.md:446-450).

## Connectivity modes

| Mode | Setup | Use case |
|------|-------|----------|
| USB | Plug in cable, tap "Allow" | Development, testing |
| WiFi (same LAN) | `adb tcpip 5555` once via USB, then `adb connect <phone-ip>:5555` | Phone and machine on same home WiFi |
| Remote (Tailscale/WireGuard) | Tailscale on phone + machine, same tailnet; `adb connect <tailscale-ip>:5555` | Phone at home, agent on a server elsewhere |
| Termux (on-device) | `pkg install android-tools`, wireless debugging, `adb pair localhost:PORT` + `adb connect <DEVICE_IP>:PORT` | Autonomous agent running on the phone |
| Emulator | `emulator -avd <name>` or Android Studio, auto-detected | CI, development |
| iOS USB | USB cable + `baremobile setup` | iOS QA/testing |

(prd.md:456-464)

ADB does not work over the open internet -- the phone and machine must share a network,
either physical (WiFi/USB) or virtual (Tailscale/WireGuard VPN) (prd.md:466).

## Integration with multis

baremobile is exposed to multis (a separate skill-calling system) as a bare-agent
tool set rather than being talked to directly. The flow is: a user messages multis from
any chat app (Telegram/WhatsApp/Signal/Beeper); multis runs on the user's machine with
baremobile registered as a skill; it makes a bare-agent tool call into baremobile;
baremobile connects to the phone via ADB or WDA over WiFi ADB, Tailscale, or USB
(prd.md:470-478). multis' skill system uses bare-agent for LLM tool calling, and
baremobile's bareagent adapter (`createMobileTools()`) registers the phone control
tools that multis invokes. The user never talks to baremobile directly -- multis decides
when to use it, controls the phone, and replies with results (prd.md:480).
