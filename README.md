```
  ┌─────────────┐
  │ ■  Settings  │
  │ ─────────── │
  │ ◉ Wi-Fi     │
  │ ◉ Bluetooth │
  │ ▸ Display   │
  └─────────────┘

  baremobile
```

> Your agent controls Android like you do -- same device, same apps, same screen.
> Prunes snapshots down to what matters. Clean YAML, zero wasted tokens.

---

## What this is

baremobile gives your AI agent control of any Android device. Tap, type, swipe, launch apps, read the screen. Pages come back as pruned accessibility snapshots with `[ref=N]` markers -- the agent picks a ref and acts on it.

It uses ADB directly -- no Appium, no Java server, no Espresso. Zero dependencies. Same patterns as [barebrowse](https://www.npmjs.com/package/barebrowse) -- agents learn one API for both web and mobile.

## Install

```
npm install baremobile
```

Requires Node.js >= 22 and `adb` in PATH (from [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools)).

## Three ways to use it

### 1. MCP server -- for Claude Desktop, Cursor, and other MCP clients

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

### 2. Library -- for agentic automation

```js
import { connect } from 'baremobile';

const page = await connect();          // auto-detect device
console.log(await page.snapshot());    // pruned YAML with refs

await page.tap(5);                     // tap element by ref
await page.type(3, 'hello world');     // type into input
await page.press('back');              // navigate back
await page.launch('com.android.settings');

page.close();
```

For the full API, wiring patterns, and integration guide, see **[baremobile.context.md](baremobile.context.md)**.

### 3. On-device via Termux -- no host machine needed

Same screen control, running on the phone itself via wireless debugging. Plus direct Android APIs (SMS, calls, GPS, camera, clipboard) through Termux:API -- no screen, no ADB needed.

See [docs/customer-guide.md](docs/customer-guide.md) for Termux setup and all three modules.

## Three modules

| Module | What it does | Requires |
|--------|-------------|----------|
| **Core ADB** | Full screen control from a host machine -- snapshots, tap/type/swipe, screenshots, app lifecycle | `adb` + USB debugging |
| **Termux ADB** | Same screen control, runs on the phone itself -- no host needed | Termux + wireless debugging |
| **Termux:API** | Direct Android APIs -- SMS, calls, GPS, camera, clipboard, contacts, notifications | Termux + Termux:API app |

## What it handles automatically

This is the obstacle course your agent doesn't have to think about:

| Obstacle | How it's handled |
|----------|-----------------|
| **Bloated accessibility trees** | 4-step pruning pipeline: collapse layout wrappers, drop noise, dedup list repeats |
| **200+ Android widget classes** | Mapped to 27 semantic roles (Button, Text, TextInput, Image, List...) |
| **Text input broken on API 35+** | Word-by-word input with automatic space injection |
| **uiautomator dump fails on API 35+** | Binary-safe temp file workaround |
| **Multi-device setups** | Serial threading on every ADB call, auto-detect by default |
| **Disabled/checked/focused states** | Rendered in snapshot -- agent sees widget state without extra calls |
| **ARIA tree fails** | Vision fallback: screenshot + grid-based tapping for Flutter, WebViews, obfuscated views |
| **Login and auth** | Agent logs in via UI like a human -- tap, type, submit |

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
| **Intent** | Deep navigation via Android intents |
| **Wait** | Poll for text or element state (checked, enabled, focused...) |
| **Grid tap** | Vision fallback: tap by grid cell when accessibility tree fails |

## iOS support (spike phase)

Exploring iPhone control from Linux -- no Mac, no Xcode, no app install on the phone. Screenshots working over USB. BLE HID input (Bluetooth keyboard/mouse) in progress.

See [docs/00-context/ios-exploration.md](docs/00-context/ios-exploration.md) for architecture and results.

## Context file

**[baremobile.context.md](baremobile.context.md)** is the full integration guide. Feed it to an AI assistant or read it yourself -- complete API, snapshot format, interaction patterns, Termux setup, vision fallback, and gotchas.

For detailed setup and usage of each module, see **[docs/customer-guide.md](docs/customer-guide.md)**.

## Device setup

1. **Enable Developer Options** -- Settings → About phone → tap "Build number" 7 times
2. **Enable USB debugging** -- Settings → Developer options → toggle on
3. **Connect** -- plug in USB, tap "Allow" on the prompt
4. **Verify** -- `adb devices` should show your device

For WiFi: `adb tcpip 5555` then `adb connect <device-ip>:5555`. For emulators: no setup needed.

## Requirements

- Node.js >= 22
- `adb` in PATH ([Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools))
- Android device or emulator with USB debugging enabled

## The bare ecosystem

Three vanilla JS modules. Zero dependencies. Same API patterns.

| | [**barebrowse**](https://npmjs.com/package/barebrowse) | [**baremobile**](https://npmjs.com/package/baremobile) | [**bareagent**](https://npmjs.com/package/bare-agent) |
|---|---|---|---|
| **Does** | Gives agents a real browser | Gives agents an Android device | Gives agents a think→act loop |
| **How** | URL in → pruned snapshot out | Screen in → pruned snapshot out | Goal in → coordinated actions out |
| **Replaces** | Playwright, Selenium, Puppeteer | Appium, Espresso, UIAutomator2 | LangChain, CrewAI, AutoGen |
| **Interfaces** | Library · CLI · MCP | Library · CLI · MCP | Library · CLI · subprocess |
| **Solo or together** | Works standalone | Works standalone | Orchestrates both as tools |

**What you can build:**

- **Headless automation** — scrape sites, fill forms, extract data, monitor pages on a schedule
- **QA & testing** — automated test suites for web and Android apps without heavyweight frameworks
- **Personal AI assistants** — chatbots that browse the web or control your phone on your behalf
- **Remote device control** — manage Android devices over WiFi, including on-device via Termux
- **Agentic workflows** — multi-step tasks where an AI plans, browses, and acts across web and mobile

**Why this exists:** Most automation stacks ship 200MB of opinions before you write a line of code. These don't. Install, import, go.

## License

MIT
