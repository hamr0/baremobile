# POC: WDA Element API — Smart Find + Tap

**Goal**: Prove WDA's element search APIs work for navigation without dumping /source.
Find element by predicate → click → verify. No regex, no coordinate guessing.

## Prerequisites
- WDA running on device (port 8100 forwarded)
- Session created

## Part 1: Element Search

Find a specific element by name without reading the full tree:
```bash
# Create session
SID=$(curl -s -X POST http://localhost:8100/session \
  -H 'Content-Type: application/json' \
  -d '{"capabilities":{}}' | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")

# Find element by predicate — O(1) lookup, no tree dump
curl -s -X POST "http://localhost:8100/session/$SID/element" \
  -H 'Content-Type: application/json' \
  -d '{"using": "predicate string", "value": "label == \"Accessibility\""}'
# → returns element ID

# Find by partial match
curl -s -X POST "http://localhost:8100/session/$SID/element" \
  -H 'Content-Type: application/json' \
  -d '{"using": "predicate string", "value": "label CONTAINS \"Keyboard\""}'
```

**Expected**: element IDs returned without reading full source.

## Part 2: Element Click (no coordinates)

Click element directly by ID — WDA resolves coordinates internally:
```bash
EID="<element-id-from-part-1>"
curl -s -X POST "http://localhost:8100/session/$SID/element/$EID/click" \
  -H 'Content-Type: application/json' -d '{}'
```

**Expected**: navigation happens, no coordinate math needed.

## Part 3: Smart Scroll-to-Element

If element exists but is off-screen, use WDA's scroll to find it:
```bash
# Find scrollable container
SCROLL=$(curl -s -X POST "http://localhost:8100/session/$SID/element" \
  -H 'Content-Type: application/json' \
  -d '{"using": "class name", "value": "XCUIElementTypeTable"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['value']['ELEMENT'])")

# Scroll within container until element appears
curl -s -X POST "http://localhost:8100/session/$SID/wda/element/$SCROLL/scroll" \
  -H 'Content-Type: application/json' \
  -d '{"name": "Keyboards"}'
```

**Expected**: scrolls to make "Keyboards" visible, then findable + clickable.

## Part 4: Element Type Differentiation

Read element type and value to distinguish toggles from navigation:
```bash
# Get element type
curl -s "http://localhost:8100/session/$SID/element/$EID/name"
# → "XCUIElementTypeSwitch" vs "XCUIElementTypeCell"

# Get switch value
curl -s "http://localhost:8100/session/$SID/element/$EID/attribute/value"
# → "0" (off) or "1" (on)

# Get element role/traits
curl -s "http://localhost:8100/session/$SID/element/$EID/attribute/type"
```

## Part 5: Full Scenario — Settings > Accessibility > Keyboards

All via element APIs, zero /source dumps:
```
1. launch com.apple.Preferences
2. find element: label == "Accessibility" → click
3. scroll to: name "Keyboards" → click
4. find element: label == "Full Keyboard Access" → read value
5. verify: on Keyboards page, FKA switch visible
```

## Part 6: Snapshot for Agent (the only /source use case)

`/source` is ONLY for building the agent-facing snapshot:
```bash
curl -s "http://localhost:8100/source" | parse-to-refs
# Output: [ref=1] Button "Back" | [ref=2] Cell "Full Keyboard Access" Off | ...
```

Internal actions (tap, scroll, find) use element search APIs, never /source.

## Success Criteria
- [ ] Navigate 3+ screens using only find+click (no coordinates)
- [ ] Scroll to off-screen element using scroll-to-name
- [ ] Differentiate switch (read value) from navigation cell
- [ ] Full scenario completes in <5 seconds total
