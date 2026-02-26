#!/bin/bash
# iOS WDA Setup — automated where possible, guided where not
# Usage: bash ios/setup.sh
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
step() { echo -e "\n${YELLOW}[$1]${NC} $2"; }

# --- Check host prerequisites ---
step 1 "Checking host prerequisites"

if command -v python3.12 &>/dev/null; then
  ok "python3.12 found"
else
  fail "python3.12 not found — install Python 3.12"
  exit 1
fi

if python3.12 -c "import pymobiledevice3" 2>/dev/null; then
  PMD_VER=$(python3.12 -c "import pymobiledevice3; print(pymobiledevice3.__version__)" 2>/dev/null || echo "unknown")
  ok "pymobiledevice3 $PMD_VER installed"
else
  warn "pymobiledevice3 not installed — installing..."
  pip3.12 install pymobiledevice3
  ok "pymobiledevice3 installed"
fi

if ldconfig -p 2>/dev/null | grep -q libdns_sd || [ -f /usr/lib64/libdns_sd.so ]; then
  ok "libdns_sd available (mDNS)"
else
  warn "libdns_sd missing — AltServer needs it for signing"
  echo "  Fix: sudo dnf install avahi-compat-libdns_sd"
  echo "       sudo ln -s /usr/lib64/libdns_sd.so.1 /usr/lib64/libdns_sd.so"
fi

# --- Check device connection ---
step 2 "Checking device connection"

DEVICE_JSON=$(python3.12 -m pymobiledevice3 usbmux list 2>/dev/null || echo "[]")
DEVICE_COUNT=$(echo "$DEVICE_JSON" | python3.12 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)

if [ "$DEVICE_COUNT" -gt 0 ]; then
  UDID=$(echo "$DEVICE_JSON" | python3.12 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d['UniqueDeviceID'])")
  NAME=$(echo "$DEVICE_JSON" | python3.12 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d.get('DeviceName','unknown'))")
  IOS=$(echo "$DEVICE_JSON" | python3.12 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d.get('ProductVersion','unknown'))")
  ok "Device: $NAME (iOS $IOS)"
  ok "UDID: $UDID"
else
  fail "No device connected via USB"
  echo "  Connect iPhone with USB cable and trust this computer"
  exit 1
fi

# --- Check Developer Mode ---
step 3 "Checking Developer Mode"

DEV_MODE=$(python3.12 -m pymobiledevice3 mounter query-developer-mode-status 2>/dev/null || echo "false")
if [ "$DEV_MODE" = "true" ]; then
  ok "Developer Mode enabled"
else
  fail "Developer Mode is OFF"
  echo "  Enable: Settings > Privacy & Security > Developer Mode > ON"
  echo "  (Requires device restart)"
  exit 1
fi

# --- Check WDA installed ---
step 4 "Checking WDA installation"

WDA_BUNDLE=$(python3.12 -m pymobiledevice3 apps list 2>/dev/null | python3.12 -c "
import sys,json
apps = json.load(sys.stdin)
wda = [k for k in apps if 'WebDriverAgent' in k]
print(wda[0] if wda else '')
" 2>/dev/null || echo "")

if [ -n "$WDA_BUNDLE" ]; then
  ok "WDA installed: $WDA_BUNDLE"
else
  fail "WDA not installed on device"
  echo "  Sign and install using AltServer:"
  echo "    ./AltServer -u $UDID -a <apple-id> -p <password> -n https://ani.sidestore.io .wda/WebDriverAgent.ipa"
  echo "  Then trust the profile: Settings > General > VPN & Device Management"
  exit 1
fi

# --- Start tunnel ---
step 5 "Starting tunnel (requires root)"

# Kill stale tunnels
STALE=$(ps aux | grep "pymobiledevice3.*start-tunnel" | grep -v grep | awk '{print $2}' | head -5)
if [ -n "$STALE" ]; then
  warn "Stale tunnel processes found — you may want to kill them"
fi

echo "Starting tunnel via pkexec (authenticate in popup)..."
TUNNEL_LOG=$(mktemp)
pkexec env PYTHONPATH="${HOME}/.local/lib/python3.12/site-packages" \
  python3.12 -m pymobiledevice3 lockdown start-tunnel > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel to establish
for i in $(seq 1 15); do
  if grep -q "tunnel created" "$TUNNEL_LOG" 2>/dev/null; then
    break
  fi
  sleep 1
done

if grep -q "tunnel created" "$TUNNEL_LOG"; then
  RSD_ADDR=$(grep "RSD Address" "$TUNNEL_LOG" | awk '{print $NF}')
  RSD_PORT=$(grep "RSD Port" "$TUNNEL_LOG" | awk '{print $NF}')
  ok "Tunnel: $RSD_ADDR port $RSD_PORT (PID $TUNNEL_PID)"
else
  fail "Tunnel failed to start — check $TUNNEL_LOG"
  cat "$TUNNEL_LOG"
  exit 1
fi

# --- Mount DDI ---
step 6 "Mounting Developer Disk Image"

MOUNTED=$(python3.12 -m pymobiledevice3 mounter list 2>/dev/null)
if echo "$MOUNTED" | python3.12 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; then
  ok "DDI already mounted"
else
  python3.12 -m pymobiledevice3 mounter auto-mount --rsd "$RSD_ADDR" "$RSD_PORT" 2>&1
  ok "DDI mounted"
fi

# --- Launch WDA ---
step 7 "Launching WDA"

WDA_LOG=$(mktemp)
python3.12 -c "
import asyncio
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.testmanaged.xcuitest import XCUITestService
async def main():
    rsd = RemoteServiceDiscoveryService(('$RSD_ADDR', $RSD_PORT))
    await rsd.connect()
    XCUITestService(rsd).run('$WDA_BUNDLE')
asyncio.run(main())
" > "$WDA_LOG" 2>&1 &
WDA_PID=$!
echo "WDA launching (PID $WDA_PID)..."
sleep 5

# --- Port forward (via built-in usbmux.js) ---
step 8 "Port forwarding 8100"

# Clear stale
fuser -k 8100/tcp 2>/dev/null || true
sleep 1

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
node -e "
const { listDevices, forward } = await import('$SCRIPT_DIR/src/usbmux.js');
const devs = await listDevices();
const server = await forward(devs[0].deviceId, 8100, 8100);
console.log('Forwarding localhost:8100 → device:8100 (PID ' + process.pid + ')');
" &
FWD_PID=$!
sleep 2

# --- Verify ---
step 9 "Verifying WDA"

STATUS=$(curl -s --connect-timeout 3 http://localhost:8100/status 2>/dev/null || echo "{}")
READY=$(echo "$STATUS" | python3.12 -c "import sys,json; d=json.load(sys.stdin); print(d.get('value',{}).get('ready',False))" 2>/dev/null || echo "False")

if [ "$READY" = "True" ]; then
  ok "WDA ready at http://localhost:8100"
  echo ""
  echo -e "${GREEN}=== Setup complete ===${NC}"
  echo "  Tunnel PID: $TUNNEL_PID"
  echo "  WDA PID:    $WDA_PID"
  echo "  Forward PID: $FWD_PID"
  echo "  WDA Bundle: $WDA_BUNDLE"
  echo ""
  echo "  To stop: kill $TUNNEL_PID $WDA_PID $FWD_PID"
  echo ""
  # Write PID file for teardown
  echo "$TUNNEL_PID $WDA_PID $FWD_PID" > /tmp/baremobile-ios-pids
  ok "PIDs saved to /tmp/baremobile-ios-pids"
else
  fail "WDA not responding"
  echo "  Check WDA log: $WDA_LOG"
  echo "  Common fix: trust developer profile on device"
  echo "    Settings > General > VPN & Device Management > Trust"
  exit 1
fi
