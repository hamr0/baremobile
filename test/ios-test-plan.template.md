# iOS Test Plan: [App Name]

> Copy this template to `test/plans/[app-name].md` and fill in per app.
> Feed to any MCP client: "Read test/plans/whatsapp.md and execute the test plan."

## App

| Field | Value |
|-------|-------|
| Bundle ID | `com.example.app` |
| Platform | ios |
| Preconditions | Logged in, internet connected |
| Passcode | _(if device locks between tests)_ |

## Navigation Map

> Snapshot the app's landing screen once and document the top-level structure.
> This saves the agent from exploring — it knows where things are upfront.

```
Tab Bar:
  - Chats (default)
  - Calls
  - Communities
  - Settings

Chats screen:
  - Search field (top)
  - Chat list (scrollable)
  - Compose button (top-right)

Chat screen:
  - Back button (nav bar)
  - Compose field (bottom)
  - Send button (appears after typing)
```

## Scenarios

### 1. [Scenario name]

**Goal:** One sentence — what this tests.

**Steps:**
1. Launch the app
2. Tap "[element text]" in [location]
3. Type "[text]" into [field description]
4. Tap "[button text]"

**Verify:**
- [ ] [Expected outcome — what the agent should see in the snapshot]
- [ ] [Second assertion if needed]

**Known issues:**
- _(e.g., "notification popup may appear — dismiss it first")_

---

### 2. [Scenario name]

**Goal:**

**Steps:**
1. ...

**Verify:**
- [ ] ...

---

## Edge Cases

> Document things the agent should handle gracefully.

| Case | What happens | How to recover |
|------|-------------|----------------|
| Notification popup | Covers part of screen | Tap outside or swipe down |
| Session expired | Login screen appears | Re-enter credentials |
| Slow network | Loading spinner persists | waitForText with longer timeout |

## Notes

- Bundle IDs: run `pymobiledevice3 apps list` to discover installed apps
- Refs change every snapshot — match elements by text/description, not ref numbers
- After any tap, take a snapshot to verify navigation before proceeding
