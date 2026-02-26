```
  ┌─────────────┐
  │ ■  Settings │
  │ ─────────── │
  │ ◉ Wi-Fi     │
  │ ◉ Bluetooth │
  │ ▸ Display   │
  └─────────────┘

  baremobile
```

> Your agent controls your phone like you do -- same device, same apps, same screen.
> Prunes snapshots down to what matters. Clean YAML, zero wasted tokens.

---

## What this is

baremobile gives your AI agent control of mobile devices. Tap, type, swipe, launch apps, read the screen. Pages come back as pruned accessibility snapshots with `[ref=N]` markers -- the agent picks a ref and acts on it.

No Appium. No Java server. No Espresso. Zero dependencies. Same patterns as [barebrowse](https://www.npmjs.com/package/barebrowse) -- agents learn one API for both web and mobile.

**Android:** Full screen control via ADB -- from a host machine or on-device via Termux. Plus direct device APIs (SMS, calls, GPS, camera, clipboard) through Termux:API.

**iOS:** Same `snapshot()` → `tap(ref)` pattern as Android. Hierarchical accessibility tree via WebDriverAgent (WDA), coordinate-based tap, type, scroll, screenshots. Shared `prune()` + `formatTree()` pipeline — identical YAML output. No Mac, no Xcode, no Bluetooth adapter required. Pure HTTP at runtime — setup uses pymobiledevice3 (Python 3.12).

## Install

```
npm install baremobile
```

Requires Node.js >= 22 and `adb` in PATH (from [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools)).

## Four ways to use it

### 1. CLI session -- for shell scripting and Claude Code

```bash
npx baremobile open                  # start daemon
npx baremobile launch com.android.settings
npx baremobile snapshot              # -> .baremobile/screen-*.yml
npx baremobile tap 4                 # tap element
npx baremobile logcat                # -> .baremobile/logcat-*.json
npx baremobile close                 # shut down
```

Full command set: `open`, `close`, `status`, `snapshot`, `screenshot`, `tap`, `tap-xy`, `tap-grid`, `type`, `press`, `scroll`, `swipe`, `long-press`, `launch`, `intent`, `back`, `home`, `wait-text`, `wait-state`, `grid`, `logcat`.

### 2. MCP server -- for Claude Desktop, Cursor, and other MCP clients

**Claude Code:**
```bash
claude mcp add baremobile -- npx baremobile mcp
```

**Claude Desktop / Cursor** -- add to your config (`claude_desktop_config.json`, `.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "baremobile": {
      "command": "npx",
      "args": ["baremobile", "mcp"]
    }
  }
}
```

10 tools: `snapshot`, `tap`, `type`, `press`, `scroll`, `swipe`, `long_press`, `launch`, `screenshot`, `back`.

### 3. Library -- for agentic automation

Import baremobile in your agent code. Connect to a device, take snapshots, tap/type/swipe by ref. Works with any LLM orchestration library. Ships with a ready-made adapter for [bareagent](https://www.npmjs.com/package/bare-agent).

For code examples, API reference, and wiring instructions, see **[baremobile.context.md](baremobile.context.md)** -- the full integration guide.

### 4. On-device via Termux -- no host machine needed

Same screen control, running on the phone itself via wireless debugging. Plus direct device APIs (SMS, calls, GPS, camera, clipboard) through Termux:API -- no screen, no ADB needed.

See [docs/customer-guide.md](docs/customer-guide.md) for Termux setup and all modules.

## Four modules

| Module | What it does | Requires |
|--------|-------------|----------|
| **Core ADB** | Full screen control from a host machine -- snapshots, tap/type/swipe, screenshots, app lifecycle | `adb` + USB debugging |
| **Termux ADB** | Same screen control, runs on the phone itself -- no host needed | Termux + wireless debugging |
| **Termux:API** | Direct device APIs -- SMS, calls, GPS, camera, clipboard, contacts, notifications | Termux + Termux:API app |
| **iOS** | Same snapshot→tap(ref) as Android. WDA-based — real element tree, native click, type, scroll. | WDA on device, USB tunnel, Python 3.12 (setup only) |

## What it handles automatically

Bloated accessibility trees (4-step pruning), 200+ widget classes mapped to semantic roles, text input quirks on newer APIs, multi-device setups, element state tracking, vision fallback for when the accessibility tree fails, and login via UI. The agent doesn't think about any of it.

## What the agent sees

```
- ScrollView [ref=1]
  - Group
    - Text "Settings"
    - Group [ref=2]
      - Text "Search settings"
  - ScrollView [ref=3]
    - List
      - Group [ref=4]
        - Text "Network & internet"
        - Text "Mobile, Wi-Fi, hotspot"
      - Group [ref=5]
        - Text "Connected devices"
        - Text "Bluetooth, pairing"
```

Compact, token-efficient. Interactive elements get `[ref=N]` markers. Agent reads the snapshot, picks a ref, acts on it.

## Actions

Everything the agent can do through baremobile:

| Action | What it does |
|--------|-------------|
| **Snapshot** | Pruned accessibility tree with `[ref=N]` markers |
| **Tap / Long press** | Tap or hold element by ref |
| **Type** | Focus + insert text, with option to clear first |
| **Press** | Keys: back, home, enter, delete, tab, escape, arrows, space, power, volume |
| **Scroll / Swipe** | Scroll within element or raw swipe between points |
| **Launch** | Open app by package name |
| **Screenshot** | Screen capture as PNG buffer |
| **Intent** | Deep navigation via intents |
| **Wait** | Poll for text or element state (checked, enabled, focused...) |
| **Grid tap** | Vision fallback: tap by grid cell when accessibility tree fails |

## Quick setup

1. `npm install baremobile`
2. Enable Developer Options -- Settings > About phone > tap "Build number" 7 times
3. Enable USB debugging -- Settings > Developer options > toggle on
4. Connect device via USB, tap "Allow" on the prompt
5. Verify -- `adb devices` should show your device
6. Pick your interface: MCP server, library import, or Termux on-device

For WiFi: `adb tcpip 5555` then `adb connect <device-ip>:5555`. For emulators: no setup needed.

Requires Node.js >= 22 and `adb` in PATH ([Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools)).

## Tested against

Settings, Messages, Chrome, Gmail, Files, Camera, Calculator, Contacts, Play Store, YouTube -- on physical devices and emulators across API 33-35.

## Context file

**[baremobile.context.md](baremobile.context.md)** is the full integration guide. Feed it to an AI assistant or read it yourself -- complete API, snapshot format, interaction patterns, Termux setup, vision fallback, and gotchas. Everything you need to wire baremobile into a project.

For detailed setup and usage of each module, see **[docs/customer-guide.md](docs/customer-guide.md)**.

## The bare ecosystem

Three vanilla JS modules. Zero dependencies. Same API patterns.

| | [**bareagent**](https://npmjs.com/package/bare-agent) | [**barebrowse**](https://npmjs.com/package/barebrowse) | [**baremobile**](https://npmjs.com/package/baremobile) |
|---|---|---|---|
| **Does** | Gives agents a think→act loop | Gives agents a real browser | Gives agents an Android device |
| **How** | Goal in → coordinated actions out | URL in → pruned snapshot out | Screen in → pruned snapshot out |
| **Replaces** | LangChain, CrewAI, AutoGen | Playwright, Selenium, Puppeteer | Appium, Espresso, UIAutomator2 |
| **Interfaces** | Library · CLI · subprocess | Library · CLI · MCP | Library · CLI · MCP |
| **Solo or together** | Orchestrates both as tools | Works standalone | Works standalone |

**What you can build:**

- **Headless automation** — scrape sites, fill forms, extract data, monitor pages on a schedule
- **QA & testing** — automated test suites for web and Android apps without heavyweight frameworks
- **Personal AI assistants** — chatbots that browse the web or control your phone on your behalf
- **Remote device control** — manage Android devices over WiFi, including on-device via Termux
- **Agentic workflows** — multi-step tasks where an AI plans, browses, and acts across web and mobile

**Why this exists:** Most automation stacks ship 200MB of opinions before you write a line of code. These don't. Install, import, go.

## License

MIT
