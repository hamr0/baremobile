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

> AI agents control your phone like you do -- same device, same apps, same screen.
> Prunes the accessibility tree down to what matters. Clean YAML, zero wasted tokens.

---

## What this is

baremobile gives AI agents full control of real mobile devices -- read the screen, tap, type, swipe, launch apps, send SMS, take photos. The screen comes back as a pruned accessibility snapshot with `[ref=N]` markers; the agent picks a ref and acts on it.

No Appium. No Java server. No Espresso. Zero runtime dependencies. Same patterns as [barebrowse](https://www.npmjs.com/package/barebrowse) -- agents learn one API for both web and mobile.

**Android** -- full screen control via ADB, plus on-device APIs (SMS, calls, GPS, camera) via Termux. Use it for QA, as a personal AI assistant, or for remote device management.

**iOS** -- same `snapshot()` → `tap(ref)` pattern via WebDriverAgent. Shared prune pipeline, identical YAML output. No Mac, no Xcode. Designed for QA (USB required on Linux).

| Platform | Mode | Where it runs | What it does | Requires |
|----------|------|--------------|-------------|----------|
| Android | **Host ADB** | Your computer | Screen control -- snapshots, tap/type/swipe, screenshots, app lifecycle | `adb` + USB or WiFi |
| Android | **Termux ADB** | On the phone | Same screen control, no host machine | Termux + wireless debugging |
| Android | **Termux:API** | On the phone | Device APIs -- SMS, calls, GPS, camera, clipboard, contacts | Termux + Termux:API app |
| iOS | **WDA** | Your computer | Screen control -- snapshots, tap/type/scroll, screenshots | USB + WDA on device |

Host ADB is the default. Termux modes run on the device itself -- useful for a phone that acts as its own autonomous agent. Termux ADB and Termux:API combine for screen control plus device APIs, all from the phone.

## Quick start

**Prerequisites:** Node.js >= 22. Android needs `adb` in PATH ([platform-tools](https://developer.android.com/tools/releases/platform-tools)). iOS needs Python 3.12 for setup (runtime is pure HTTP).

```
npm install baremobile
```

**Three flavors:** CLI, MCP server, or library import. Pick one.

### CLI

```bash
npx baremobile open                       # start daemon
npx baremobile launch com.android.settings
npx baremobile snapshot                   # -> .baremobile/screen-*.yml
npx baremobile tap 4                      # tap ref 4
npx baremobile close                      # shut down
```

Full command set: `open`, `close`, `status`, `snapshot`, `screenshot`, `tap`, `tap-xy`, `tap-grid`, `type`, `press`, `scroll`, `swipe`, `long-press`, `launch`, `intent`, `back`, `home`, `wait-text`, `wait-state`, `grid`, `logcat`.

### MCP server

Claude Code:
```bash
claude mcp add baremobile -- npx baremobile mcp
```

Claude Desktop / Cursor -- add to config (`claude_desktop_config.json`, `.cursor/mcp.json`):
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

### Library

```js
import { connect } from 'baremobile';

const page = await connect();              // auto-detect device
const snapshot = await page.snapshot();     // pruned YAML with [ref=N] markers

await page.tap(5);                         // tap element
await page.type(3, 'hello');               // type into field
await page.scroll(1, 'down');              // scroll
await page.launch('com.android.chrome');   // open app
await page.back();                         // navigate back
```

Works with any LLM orchestration library. Ships with an adapter for [bareagent](https://www.npmjs.com/package/bare-agent).

Full API, snapshot format, interaction patterns, and gotchas: **[baremobile.context.md](baremobile.context.md)**.

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

Compact, token-efficient. Interactive elements get `[ref=N]` markers. The agent reads the snapshot, picks a ref, acts on it. Bloated accessibility trees get a 4-step pruning pass, 200+ widget classes mapped to semantic roles. Text input quirks, multi-device setups, element state tracking, and vision fallback are handled automatically.

## Device setup

1. Enable Developer Options -- Settings > About phone > tap "Build number" 7 times
2. Enable USB debugging -- Settings > Developer options > toggle on
3. Connect device via USB, tap "Allow" on the prompt
4. Verify -- `adb devices` should show your device

For WiFi: `adb tcpip 5555` then `adb connect <device-ip>:5555`. For emulators: no setup needed. For Termux and iOS setup, see [docs/customer-guide.md](docs/customer-guide.md).

## Tested against

Settings, Messages, Chrome, Gmail, Files, Camera, Calculator, Contacts, Play Store, YouTube -- on physical devices and emulators across API 33-35.

## The bare ecosystem

Three vanilla JS modules. Zero dependencies. Same API patterns.

| | [**bareagent**](https://npmjs.com/package/bare-agent) | [**barebrowse**](https://npmjs.com/package/barebrowse) | [**baremobile**](https://npmjs.com/package/baremobile) |
|---|---|---|---|
| **Does** | Gives agents a think→act loop | Gives agents a real browser | Gives agents a mobile device |
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
