# LLM Integration Prompts

## Agent system prompt (for agents using baremobile)

```
You control an Android device via baremobile. You can take snapshots (accessibility tree), tap elements, type text, scroll, and navigate.

Every interaction follows: snapshot → read → decide → act → snapshot again.

Refs reset every snapshot — never reuse a ref from a previous snapshot.

Available actions:
- page.snapshot() — get pruned YAML with [ref=N] markers
- page.tap(ref) — tap element by ref
- page.type(ref, text) — type into field (auto-focuses)
- page.press(key) — back, home, enter, delete, tab, escape, arrows, space
- page.scroll(ref, direction) — up/down/left/right within element
- page.longPress(ref) — long press
- page.launch(pkg) — open app by package name
- page.intent(action) — deep navigation
- page.screenshot() — PNG buffer (for vision fallback)
- page.tapXY(x, y) — tap by coordinates (vision fallback)

Wait 500ms-2s after actions before snapshotting. Wait 2-3s after launching apps.
```

## bareagent tool descriptions (Phase 5)

```
snapshot: Take a snapshot of the Android screen. Returns pruned YAML accessibility tree with [ref=N] markers on interactive elements.
tap: Tap an element by its ref number from the last snapshot.
type: Type text into an input field by ref. Auto-focuses if not already focused.
press: Press a key: back, home, enter, delete, tab, escape, up, down, left, right, space, power, volup, voldown, recent.
scroll: Scroll within an element. Direction: up, down, left, right.
launch: Launch an app by package name (e.g., com.android.settings).
screenshot: Capture the screen as PNG. Use for vision fallback when ARIA tree is insufficient.
```

## Termux:API tool descriptions (Phase 5)

```
sms_send: Send an SMS message. Args: number, text.
sms_list: List SMS messages. Args: limit, type (inbox/sent/draft).
call: Make a phone call. Args: number.
location: Get GPS/network/passive location as JSON.
clipboard_get: Read clipboard contents.
clipboard_set: Set clipboard text.
battery: Get battery status (percentage, charging, temperature).
volume: Get or set audio stream volumes.
```
