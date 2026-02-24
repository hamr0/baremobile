# Insights

## Android accessibility tree is surprisingly good

uiautomator dump gives a structured XML tree with bounds, text, class, states — comparable to web ARIA. 27 class-to-role mappings cover >95% of widgets. 4-step pruning (collapse, drop, dedup, ref) reduces tree to agent-friendly size. Token count is typically <2K for a full screen.

## Termux can't inject input without ADB

Key insight from Phase 2: Termux runs as a regular Android app. It has no `INJECT_EVENTS` permission — only ADB shell user does. So Termux alone cannot tap/type/swipe. The path is: Termux → install android-tools → `adb connect localhost:PORT` → use wireless debugging. ADB provides the privilege escalation.

## Termux:API is fire-and-forget reliable

`termux-battery-status`, `termux-clipboard-get/set`, `termux-volume`, `termux-wifi-connectioninfo` — all return well-formed JSON instantly. The `execFile` + `JSON.parse` pattern in Node.js works exactly as designed. No parsing issues, no encoding problems.

## Wireless debugging is fragile

Android wireless debugging (required for Termux ADB) drops on every reboot. Must re-enable in Developer Options each time. The pairing port differs from the connect port (common source of confusion). Connection is reliable once established, but setup friction is real.

## Flutter and WebViews are the main gaps

uiautomator tree is empty/shallow for WebViews. Flutter apps can crash uiautomator entirely (StackOverflowError from deep widget trees). Vision fallback (screenshot + tapXY/tapGrid) covers these cases but loses the structured data advantage.

## Word-by-word typing is slow but necessary

API 35+ broke `input text "hello world"`. The word-by-word + KEYCODE_SPACE workaround works but adds ~100ms per word due to key event injection. Acceptable for agent use (agents don't type essays) but worth noting for latency-sensitive flows.

## Settings app state persistence

`launch('com.android.settings')` resumes the last activity, not the main screen. Tests that assert specific Settings content must account for this. `intent()` is more reliable for reaching specific subsections.
