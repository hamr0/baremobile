#!/bin/bash
# POC: Smart navigation using WDA element APIs
# No /source dumps, no regex, no coordinate guessing
set -e

BASE="http://localhost:8100"

# Helper: JSON POST
post() { curl -s -X POST "$1" -H 'Content-Type: application/json' -d "$2" 2>/dev/null; }
get()  { curl -s "$1" 2>/dev/null; }

# Create session
echo "=== Creating session ==="
SID=$(post "$BASE/session" '{"capabilities":{}}' | python3.12 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")
echo "Session: $SID"
S="$BASE/session/$SID"

# Helper: find element by predicate, return element ID
find_el() {
  local pred="$1"
  post "$S/element" "{\"using\": \"predicate string\", \"value\": \"$pred\"}" \
    | python3.12 -c "import sys,json; d=json.load(sys.stdin); v=d.get('value',{}); print(v.get('ELEMENT','') if isinstance(v,dict) and 'ELEMENT' in v else f'ERROR: {v}')"
}

# Helper: find multiple elements
find_els() {
  local pred="$1"
  post "$S/elements" "{\"using\": \"predicate string\", \"value\": \"$pred\"}" \
    | python3.12 -c "
import sys,json
d=json.load(sys.stdin)
for el in d.get('value',[]):
    print(el.get('ELEMENT',''))
"
}

# Helper: click element
click_el() {
  local eid="$1"
  post "$S/element/$eid/click" '{}' | python3.12 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('value') is None else f'ERROR: {d}')"
}

# Helper: get element attribute
attr() {
  local eid="$1" name="$2"
  get "$S/element/$eid/attribute/$name" | python3.12 -c "import sys,json; print(json.load(sys.stdin).get('value',''))"
}

# Helper: scroll to element by name within a container
scroll_to() {
  local container_eid="$1" name="$2"
  post "$S/wda/element/$container_eid/scroll" "{\"name\": \"$name\"}" \
    | python3.12 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('value') is None else f'ERROR: {d}')"
}

# Helper: get element type
el_type() {
  local eid="$1"
  get "$S/element/$eid/name" | python3.12 -c "import sys,json; print(json.load(sys.stdin).get('value',''))"
}

echo ""
echo "=== Part 1: Launch Settings ==="
post "$S/wda/apps/launch" '{"bundleId":"com.apple.Preferences"}' > /dev/null
sleep 1
echo "Settings launched"

echo ""
echo "=== Part 2: Find Accessibility (element search, no source dump) ==="
EL=$(find_el "label == 'Accessibility' AND type == 'XCUIElementTypeStaticText'")
if [[ "$EL" == ERROR* ]]; then
  echo "Not visible, scrolling..."
  TABLE=$(find_el "type == 'XCUIElementTypeTable'")
  echo "Table: $TABLE"
  scroll_to "$TABLE" "Accessibility"
  EL=$(find_el "label == 'Accessibility' AND type == 'XCUIElementTypeStaticText'")
fi
echo "Found: $EL"
TYPE=$(el_type "$EL")
echo "Type: $TYPE"
echo "Clicking..."
click_el "$EL"
sleep 1

echo ""
echo "=== Part 3: Scroll to Keyboards (scroll-to-name) ==="
TABLE=$(find_el "type == 'XCUIElementTypeTable'")
echo "Table: $TABLE"
echo "Scrolling to Keyboards..."
scroll_to "$TABLE" "Keyboards"
sleep 0.5

echo ""
echo "=== Part 4: Find and click Keyboards ==="
EL=$(find_el "label == 'Keyboards' OR label == 'Keyboards & Typing'")
if [[ "$EL" == ERROR* ]]; then
  # Try alternate name
  EL=$(find_el "label CONTAINS 'Keyboard'")
fi
echo "Found: $EL"
click_el "$EL"
sleep 1

echo ""
echo "=== Part 5: Read Full Keyboard Access switch ==="
FKA=$(find_el "label CONTAINS 'Full Keyboard Access'")
echo "FKA element: $FKA"
FKA_TYPE=$(el_type "$FKA")
FKA_VALUE=$(attr "$FKA" "value")
echo "Type: $FKA_TYPE"
echo "Value: $FKA_VALUE (0=off, 1=on)"

echo ""
echo "=== Part 6: Differentiate element types ==="
# Find all cells and switches on this page
echo "Switches:"
for eid in $(find_els "type == 'XCUIElementTypeSwitch'"); do
  label=$(attr "$eid" "label")
  value=$(attr "$eid" "value")
  echo "  SWITCH: $label = $value"
done

echo "Navigation cells (with chevron):"
for eid in $(find_els "type == 'XCUIElementTypeCell' AND visible == true"); do
  label=$(attr "$eid" "label")
  if [[ -n "$label" && "$label" != "" ]]; then
    echo "  CELL: $label"
  fi
done

echo ""
echo "=== Done ==="
echo "Navigated Settings > Accessibility > Keyboards using element APIs only."
echo "No /source dump, no regex, no coordinate math."
