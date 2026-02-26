#!/bin/bash
# POC: Tab+F (FKA Find) to tap an element by its accessibility label.
#
# Prerequisites:
#   - ios-tunnel.sh running (RSD tunnel active)
#   - ble-hid-poc.py running (BLE paired, FIFO at /tmp/ios-ble-hid.fifo)
#   - Full Keyboard Access enabled on iPhone
#
# Usage:
#   ./test/ios/poc-find-tap.sh           # dump ax tree, pick a label, try Find
#   ./test/ios/poc-find-tap.sh "Wi-Fi"   # directly try to find "Wi-Fi"

FIFO="/tmp/ios-ble-hid.fifo"
RSD_FILE="/tmp/ios-rsd-address"

if [ ! -p "$FIFO" ]; then
    echo "ERROR: BLE FIFO not found at $FIFO — is ble-hid-poc.py running?"
    exit 1
fi

send_cmd() {
    echo "$1" > "$FIFO"
    echo "  -> $1"
    sleep "${2:-0.3}"
}

# If no label given, dump the ax tree first
if [ -z "$1" ]; then
    echo "=== Accessibility Tree ==="
    RSD=($(cat "$RSD_FILE"))
    python3.12 scripts/ios-ax.py --rsd "${RSD[0]}" "${RSD[1]}" dump | python3.12 -m json.tool | head -80
    echo ""
    echo "Pick a label from above and run:"
    echo "  $0 \"Label Text\""
    exit 0
fi

LABEL="$1"
echo "=== POC: Tab+F Find for '$LABEL' ==="

# Step 1: Send Tab+F (FKA Find command)
# Tab = 0x2B, F = 0x09 (HID keycode for 'f')
# In FKA, Tab acts as the command modifier
echo "Step 1: Tab+F (open Find dialog)"
send_cmd "send_combo tab f" 1.0

# Step 2: Type the label text
echo "Step 2: Typing label '$LABEL'"
send_cmd "send_string $LABEL" 1.0

# Step 3: Enter to confirm / jump to element
echo "Step 3: Enter (confirm find)"
send_cmd "send_key enter" 0.5

# Step 4: Space to activate
echo "Step 4: Space (activate element)"
send_cmd "send_key space" 0.5

echo "=== Done ==="
echo "Check the iPhone — did it find and tap '$LABEL'?"
