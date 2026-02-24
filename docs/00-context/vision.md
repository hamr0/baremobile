# Vision

## What baremobile is

ADB-direct Android device control for autonomous agents. Accessibility tree in, pruned snapshot out.

Same patterns as [barebrowse](https://github.com/hamr0/barebrowse) (web) -- agents learn one API, use it for both web and mobile.

## Why it exists

AI agents need to control phones the way humans do -- same device, same apps, same screen. Existing tools (Appium, DroidRun) bring heavy dependencies, complex setup, or startup constraints. baremobile is the minimal alternative: zero dependencies, ADB direct, vanilla JS.

## What it is NOT

- Not a test framework (no assertions, no test runner)
- Not a screen recorder or scraper
- Not an Appium replacement (no WebDriver protocol)
- Not iOS (see `00-context/ios-exploration.md` for why)

## Core principles

1. **Zero dependencies** -- `child_process.execFile('adb', ...)` is the transport
2. **Agent-first** -- pruned YAML snapshots, `[ref=N]` markers, same format as barebrowse
3. **Three capability layers** -- Core ADB (screen control), Termux ADB (on-device screen control), Termux:API (direct Android APIs)
4. **POC first** -- validate before building, never ship the POC
5. **Open-source only** -- no vendor lock-in

## Boundaries

| In scope | Out of scope |
|----------|-------------|
| Android devices via ADB | iOS (platform policy blocks it) |
| Native app UI control | WebView content (future: CDP bridge) |
| Accessibility tree snapshots | Screenshot-only automation |
| Termux on-device control | Root-required features |
| Direct Android APIs (Termux:API) | Multi-touch gestures (future) |
