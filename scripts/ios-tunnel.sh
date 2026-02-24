#!/usr/bin/env bash
#
# iOS developer bridge — single script for all pymobiledevice3 services.
# Manages usbmuxd + lockdown tunnel + developer image mount.
#
# Usage:
#   ./scripts/ios-tunnel.sh              # start bridge (usbmuxd + tunnel)
#   ./scripts/ios-tunnel.sh setup        # first-time: reveal dev mode + enable WiFi
#   ./scripts/ios-tunnel.sh check        # run prerequisite checker
#
# After starting, run tests with:
#   npm run test:ios
#
# The script writes the RSD address to /tmp/ios-rsd-address so tests can
# pick it up automatically (or use RSD_ADDRESS env var).

set -euo pipefail

PYTHON=python3.12
PYTHONPATH_USER="$HOME/.local/lib/python3.12/site-packages"
RSD_FILE="/tmp/ios-rsd-address"
TUNNEL_PID=""
USBMUXD_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null && echo "  tunnel stopped"
  [ -n "$USBMUXD_PID" ] && sudo kill "$USBMUXD_PID" 2>/dev/null && echo "  usbmuxd stopped"
  rm -f "$RSD_FILE"
  exit 0
}
trap cleanup INT TERM

pmd3() {
  $PYTHON -m pymobiledevice3 "$@"
}

ensure_usbmuxd() {
  if systemctl is-active --quiet usbmuxd 2>/dev/null; then
    echo "[ok] usbmuxd already running (systemd)"
    return
  fi
  echo "[..] Starting usbmuxd..."
  sudo usbmuxd -f &
  USBMUXD_PID=$!
  sleep 2
  echo "[ok] usbmuxd started (pid $USBMUXD_PID)"
}

wait_for_device() {
  echo "[..] Waiting for iPhone (USB)..."
  for i in $(seq 1 30); do
    local count
    count=$(pmd3 usbmux list 2>/dev/null | $PYTHON -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
    if [ "$count" -gt 0 ]; then
      local name
      name=$(pmd3 usbmux list 2>/dev/null | $PYTHON -c "import sys,json; d=json.load(sys.stdin)[0]; print(f\"{d['DeviceName']} — iOS {d['ProductVersion']} ({d['ConnectionType']})\")" 2>/dev/null || echo "unknown")
      echo "[ok] $name"
      return 0
    fi
    printf "     %d/30\r" "$i"
    sleep 1
  done
  echo "[FAIL] No iPhone detected after 30s."
  echo "       Plug in via USB and make sure you tapped 'Trust This Computer'."
  exit 1
}

mount_developer_image() {
  echo "[..] Mounting developer disk image..."
  if pmd3 mounter auto-mount 2>&1 | grep -q "mounted successfully\|already mounted"; then
    echo "[ok] Developer image mounted"
  else
    echo "[warn] Could not mount developer image — phone may be locked"
  fi
}

start_tunnel() {
  echo "[..] Starting lockdown tunnel (needs sudo)..."
  # Run tunnel and capture output to extract RSD address
  sudo PYTHONPATH="$PYTHONPATH_USER" $PYTHON -m pymobiledevice3 lockdown start-tunnel 2>&1 &
  TUNNEL_PID=$!

  # Wait for tunnel to print RSD address
  sleep 3
  for i in $(seq 1 10); do
    # Read from /proc to get tunnel output — check if tun interface appeared
    if ip link show tun0 &>/dev/null; then
      # Extract RSD from the tunnel's log — parse from process
      local rsd_line
      rsd_line=$(ip -6 addr show tun0 2>/dev/null | grep -oP 'inet6 \K[^/]+' | head -1)
      if [ -n "$rsd_line" ]; then
        # The RSD port is typically on the tunnel — get it from the process
        # For now, use the standard approach
        echo "[ok] Tunnel interface tun0 is up"
        break
      fi
    fi
    sleep 1
  done

  # Try to discover the tunnel
  local rsd_info
  rsd_info=$(pmd3 remote browse 2>/dev/null || echo "{}")
  local rsd_addr rsd_port
  rsd_addr=$($PYTHON -c "
import json,sys
d=json.loads('''$rsd_info''')
devs = d.get('usb',[]) + d.get('wifi',[])
if devs: print(devs[0].get('address',''), devs[0].get('port',''))
" 2>/dev/null || echo "")

  if [ -n "$rsd_addr" ]; then
    echo "$rsd_addr" > "$RSD_FILE"
    echo "[ok] RSD address: $rsd_addr (saved to $RSD_FILE)"
  else
    echo "[info] Tunnel running but couldn't auto-detect RSD address."
    echo "       Check the output above for 'RSD Address' and 'RSD Port', then:"
    echo "       echo 'HOST PORT' > $RSD_FILE"
  fi
}

# === Commands ===

cmd_setup() {
  echo "=== iOS First-Time Setup ==="
  ensure_usbmuxd
  wait_for_device

  echo "[..] Revealing Developer Mode..."
  pmd3 amfi reveal-developer-mode
  echo "[ok] Developer Mode toggle revealed"

  echo "[..] Enabling WiFi connections..."
  pmd3 lockdown wifi-connections --state on
  echo "[ok] WiFi connections enabled"

  echo ""
  echo "Done. On your iPhone:"
  echo "  Settings > Privacy & Security > Developer Mode > ON > Restart"
  echo ""
  echo "After restart, run: ./scripts/ios-tunnel.sh"
}

cmd_check() {
  exec node test/ios/check-prerequisites.js
}

cmd_start() {
  echo "=== iOS Developer Bridge ==="
  ensure_usbmuxd
  wait_for_device
  mount_developer_image
  start_tunnel

  echo ""
  echo "Bridge running. Tests:"
  echo "  npm run test:ios"
  echo ""
  echo "Press Ctrl+C to stop."
  wait
}

case "${1:-start}" in
  setup) cmd_setup ;;
  check) cmd_check ;;
  start|"") cmd_start ;;
  *) echo "Usage: $0 [setup|check|start]"; exit 1 ;;
esac
