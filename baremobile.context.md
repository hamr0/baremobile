# baremobile — Agent Integration Guide

Use this file as context when building agents that control Android devices via baremobile.

## Core Loop

Every agent interaction follows observe-think-act:

```js
import { connect } from 'baremobile';

const page = await connect();    // auto-detect device
let snapshot = await page.snapshot();  // observe

// Agent reads snapshot, picks action
await page.tap(5);               // act
snapshot = await page.snapshot(); // observe again
```

Always snapshot after every action. Refs reset per snapshot — never cache them.

## Snapshot Format

```
- ScrollView [ref=1]
  - Group
    - Text "Settings"
    - Group [ref=2]
      - Text "Search settings"
  - List
    - Group [ref=3]
      - Text "Wi-Fi"
      - Switch [ref=4] (Wi-Fi) [checked]
    - Group [ref=5] [disabled]
      - Text "Airplane mode"
```

**What to read:**
- `[ref=N]` — interactive element, use with tap/type/scroll
- `"quoted text"` — visible text on screen
- `(parenthesized)` — contentDesc / accessibility label
- `[checked]`, `[selected]`, `[focused]`, `[disabled]` — element state
- Indentation = nesting (parent-child)

**Roles:** Text, TextInput, Button, Image, ImageButton, CheckBox, Switch, Radio, Toggle, Slider, Progress, Select, List, ScrollView, Group, TabList, Tab. Unknown classes show their short Java class name.

## Page Methods

### Navigation
```js
await page.launch('com.android.settings');  // open app by package
await page.back();                          // press back
await page.home();                          // press home
await page.press('recent');                 // app switcher
```

### Reading
```js
const yaml = await page.snapshot();    // pruned YAML with refs
const png = await page.screenshot();   // PNG buffer
```

### Interaction
```js
await page.tap(ref);                        // tap element
await page.type(ref, 'text');               // type into field
await page.type(ref, 'new', {clear: true}); // clear field first, then type
await page.press('enter');                  // press key
await page.scroll(ref, 'down');             // scroll within element
await page.longPress(ref);                  // long press
await page.swipe(x1, y1, x2, y2, 300);     // raw swipe
```

### Keys for press()
back, home, enter, delete, tab, escape, up, down, left, right, space, power, volup, voldown, recent

## Common Patterns

### Type into a field
```
Snapshot shows:  TextInput [ref=3] "Search settings" [focused]
```
- If `[focused]` — just type, no extra tap needed: `page.type(3, 'wifi')`
- If not focused — `page.type(3, 'wifi')` will tap first automatically
- To replace existing text: `page.type(3, 'new text', {clear: true})`

### Navigate a list
```
Snapshot shows:  ScrollView [ref=1] → List → Group [ref=2] "Wi-Fi" ...
```
- Tap an item: `page.tap(2)`
- Scroll for more: `page.scroll(1, 'down')` then snapshot again
- Items at the bottom may not be visible — scroll and re-snapshot

### Handle a dialog
```
Snapshot shows:  Text "Allow access?" → Button [ref=5] "Allow" → Button [ref=6] "Deny"
```
- Read dialog text, decide, tap the appropriate button
- Dialogs always have their buttons in the snapshot with refs

### Open an app
```js
await page.launch('com.android.settings');
await new Promise(r => setTimeout(r, 2000)); // wait for app to load
const snapshot = await page.snapshot();
```
Common packages: `com.android.settings`, `com.android.chrome`, `com.google.android.apps.messaging`, `com.google.android.dialer`, `com.android.contacts`

### Send a message (multi-step)
1. `launch('com.google.android.apps.messaging')`
2. Snapshot → find "Start chat" button → `tap(ref)`
3. Snapshot → find TextInput for "To:" → `type(ref, '5551234567')`
4. Snapshot → find suggestion like "Send to (555) 123-4567" → `tap(ref)`
5. Snapshot → find compose TextInput → `type(ref, 'Hello!')`
6. Snapshot → find "Send SMS" button → `tap(ref)`

Each step: snapshot, read, decide, act. The agent adapts to whatever the UI shows.

### Pick an emoji
1. In compose view, find emoji button (contentDesc contains "emoji") → `tap(ref)`
2. Snapshot → emoji grid appears, each emoji is `View [ref=N] (😀)` with name in contentDesc
3. Tap the emoji ref → it inserts into the TextInput
4. Press back or tap outside to close emoji panel

### Attach a file
1. Find attach/`+` button (contentDesc "Show attach" or "Show more options") → `tap(ref)`
2. Snapshot → options appear: Gallery, Files, Location, etc. → `tap(ref)` for Files
3. System file picker opens → snapshot shows folders and files with refs
4. Navigate to file → `tap(ref)` to select

### Unlock the screen
```js
await page.press('power');           // wake
await page.swipe(540, 1800, 540, 800, 300);  // swipe up
await page.type(ref, '1234');        // PIN (if needed)
await page.press('enter');
```

## Gotchas

**Refs reset every snapshot.** Never store a ref and use it after another snapshot. Always re-read.

**Snapshot takes 1-5 seconds.** uiautomator dump is slow, especially on emulators. Don't snapshot in a tight loop.

**Wait after actions.** UI needs time to settle. Wait 500ms-2s after taps, 2-3s after launching apps.

**Some list items aren't clickable.** Android file picker drawer items, some system UI elements don't have `clickable=true` so they don't get refs. Use raw `swipe()` to coordinates as fallback.

**WebView content is invisible.** uiautomator can't see inside WebViews. If the snapshot looks empty/shallow in a browser or hybrid app, that's why. Future: CDP bridge.

**HTML entities in text.** XML attributes may contain `&amp;`, `&#128512;`, `&#10;` etc. These are XML-encoded. `&amp;` = `&`, `&#10;` = newline, `&#128512;` = 😀.

**Emojis show as entities in contentDesc.** `View [ref=8] (&#128512;)` means the emoji 😀. The agent can read the unicode codepoint or just tap by ref position in the grid.

**type() is word-by-word.** On API 35+, `adb input text` is broken for spaces. baremobile splits text into words and injects KEYCODE_SPACE between them. This means typing is slower for long strings.

## Device Setup

```bash
# Check device connected
adb devices

# Start emulator (if using Android Studio)
emulator -avd Pixel_8_API_35 -no-window  # headless

# Install an app
adb install path/to/app.apk

# Forward port (for future WebView CDP)
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

## Error Recovery

If an action doesn't seem to work:
1. **Snapshot again** — the UI may have changed during the action
2. **Wait longer** — some transitions take 2-3 seconds
3. **Screenshot** — visual check if the snapshot seems wrong
4. **Press back** — if stuck in an unexpected state, back out and retry
5. **Home + relaunch** — nuclear option to reset to known state
