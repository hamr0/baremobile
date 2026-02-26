# WDA iOS Automation POC — Session Stash
**Date**: 2026-02-26
**Goal**: Install WebDriverAgent on iPhone from Linux to get element coordinates + tap injection

## Current State: BLOCKED on Apple signing

### What works
- Pre-built WDA downloaded and packaged: `.wda/WebDriverAgent.ipa` (from appium/WebDriverAgent v11.1.6)
- AltServer-Linux v0.0.5 downloaded: `.wda/AltServer`
- Sideloader CLI downloaded: `.wda/sideloader-cli-x86_64-linux-gnu` (segfaults on install, cert list works)
- Anisette server: `https://ani.sidestore.io` (HTTPS, works)
- System deps: `avahi-compat-libdns_sd` installed, symlink at `/usr/lib64/libdns_sd.so`
- Docker: `nyamisty/alt_anisette_server` pulled but broken (Wine+iCloud crashes)
- pymobiledevice3 7.7.2 installed (python3.12)
- Device detection works via pymobiledevice3

### Two Apple IDs attempted

**Original: `avoidaccess@msn.com`**
- AltServer auth: WORKS (got Xcode token, fetched team, registered device)
- BLOCKED: error 5405 "maximum number of registered iPhone devices"
- Free account, can't clear device registrations (7-day auto-expiry)
- User removed devices from Apple ID settings but dev provisioning devices are separate

**New throwaway: `5dwbp0414@mozmail.com`**
- Created fresh, accepted developer agreement at developer.apple.com
- 2FA enabled (required by Apple), associated with a second iPhone (iPhone 8, iOS 16.7)
- BLOCKED: error -22406 "Enter the correct password"
- Tried: regular password, app-specific password — both fail
- Likely cause: AltServer can't handle 2FA challenge for developer services auth
- App-specific passwords don't work with GSA/SRP auth flow

### Two iPhones detected
- **iPhone 13 mini** (primary target): UDID `00008110-000665682188201E`, iOS 26.3, iPhone14,4
- **iPhone 8** (2FA device): UDID `aeeddcdfe9141cc768795cad434f828332c1e85d`, iOS 16.7.10, iPhone10,1

## Key Findings

### WDA Technical Details
- XCTest bundle (Obj-C, ~180 files) running "never-ending test" with HTTP server on port 8100
- Uses private APIs: `XCAXClient_iOS` (element tree with frames) + `XCSynthesizedEventRecord` (tap injection)
- Works for ALL apps, not just Apple's
- WiFi works: `http://<device-ip>:8100` after initial USB install+launch
- Pre-built unsigned .app available from appium/WebDriverAgent GitHub releases

### Why signing is mandatory
- iOS kernel (AMFI) kills unsigned code — no exceptions on non-jailbroken devices
- Needs `get-task-allow = YES` entitlement for testmanagerd XPC connection
- USB trust alone gives: screenshots, app install, syslog — NOT element queries or tap injection

### pymobiledevice3 AccessibilityAudit limitations
- `iter_elements()` returns: caption, spoken_description, element (opaque), platform_identifier
- NO rect, NO frame, NO coordinates
- `rect` only on `AXAuditIssue_v1` (from `run_audit()`), not navigation elements
- `perform_press()` needs `task_for_pid-allow` — dead end on consumer devices

### App Store Connect API (paid $99/year)
- REST API from Linux: create certs, register devices, create profiles
- `POST /v1/certificates`, `POST /v1/devices`, `POST /v1/profiles`
- JWT auth with `.p8` key — fully scriptable, no hacks
- Only available with paid Apple Developer Program

### Free account signing tools
- **AltServer-Linux**: works but 2FA handling is broken for new accounts
- **Sideloader CLI**: segfaults on Fedora 43 (D runtime compat issue)
- **zsign**: can sign IPAs on Linux, but needs cert+profile (which need Apple's private API)
- **xtool**: builds SwiftPM projects, not pre-built IPAs; needs paid account

### BLE+FKA approach (fallback)
- Ctrl+Tab×N linear traversal works for all apps, no signing needed
- Tab+F (Find) POC failed — context-dependent, unreliable
- Mouse Keys (8/K/U/O/I) — no acceleration, but still needs coordinates we don't have
- Spotlight (Cmd+Space) — macro navigation only, not element targeting

## Unresolved Options
1. **Retry original Apple ID** (`avoidaccess@msn.com`) — device registrations may have cleared
2. **Fix 2FA for new Apple ID** — sign into icloud.com first to establish trust, then retry AltServer
3. **Pay $99/year** — App Store Connect API, clean automation, 1-year certs, zero hacks
4. **Path 4: Hybrid ax tree + OCR** — match labels from iter_elements() to screenshot positions via tesseract, no signing needed
5. **Path 3: Vision model** — screenshot + GPT-4V/Claude to identify elements, tap via BLE

## Files
- `.wda/WebDriverAgent.ipa` — packaged unsigned WDA
- `.wda/AltServer` — AltServer-Linux binary
- `.wda/sideloader-cli-x86_64-linux-gnu` — Sideloader CLI
- `.wda/apple_devices.py` — incomplete Apple API script
- `test/ios/poc-find-tap.sh` — Tab+F POC script (failed)
- Memory: `memory/ios-explore.md` — comprehensive reference doc
