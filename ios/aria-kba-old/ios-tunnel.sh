#!/usr/bin/env bash
#
# iOS developer bridge — single script for all pymobiledevice3 services.
# Manages usbmuxd + lockdown tunnel + developer image mount + BLE HID.
#
# Usage:
#   ./scripts/ios-tunnel.sh              # start bridge (USB tunnel + BLE HID)
#   ./scripts/ios-tunnel.sh --wifi       # start bridge over WiFi (cable-free)
#   ./scripts/ios-tunnel.sh --no-ble     # start bridge without BLE HID
#   ./scripts/ios-tunnel.sh stop         # stop bridge from PID files
#   ./scripts/ios-tunnel.sh setup        # first-time: reveal dev mode + enable WiFi + remote pair
#   ./scripts/ios-tunnel.sh check        # run prerequisite checker
#
# After starting, run tests with:
#   npm run test:ios
#
# The script writes the RSD address to /tmp/ios-rsd-address so tests can
# pick it up automatically (or use RSD_ADDRESS env var).

set -euo pipefail

PYTHON=python3.12
BLE_PYTHON=python3
PYTHONPATH_USER="$HOME/.local/lib/python3.12/site-packages"
RSD_FILE="/tmp/ios-rsd-address"
TUNNEL_PID_FILE="/tmp/ios-tunnel.pid"
BLE_PID_FILE="/tmp/ios-ble-hid.pid"
POC_SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/test/ios/ble-hid-poc.py"
TUNNEL_PID=""
USBMUXD_PID=""
BLE_PID=""
NO_BLE=false
WIFI_MODE=false

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$BLE_PID" ] && sudo kill "$BLE_PID" 2>/dev/null && echo "  BLE HID stopped"
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null && echo "  tunnel stopped"
  [ -n "$USBMUXD_PID" ] && sudo kill "$USBMUXD_PID" 2>/dev/null && echo "  usbmuxd stopped"
  rm -f "$RSD_FILE" "$TUNNEL_PID_FILE" "$BLE_PID_FILE"
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
  local tunnel_log="/tmp/ios-tunnel.log"
  rm -f "$tunnel_log"

  if $WIFI_MODE; then
    echo "[..] Starting WiFi tunnel (needs sudo)..."
    echo "     Enter sudo password if prompted:"
    sudo true

    sudo PYTHONPATH="$PYTHONPATH_USER" $PYTHON -m pymobiledevice3 remote start-tunnel --connection-type wifi --protocol tcp 2>&1 | tee "$tunnel_log" &
  else
    echo "[..] Starting lockdown tunnel (needs sudo)..."
    echo "     Enter sudo password if prompted:"
    sudo true

    sudo PYTHONPATH="$PYTHONPATH_USER" $PYTHON -m pymobiledevice3 lockdown start-tunnel 2>&1 | tee "$tunnel_log" &
  fi
  TUNNEL_PID=$!
  echo "$TUNNEL_PID" > "$TUNNEL_PID_FILE"

  # Poll log file for RSD address
  local rsd_addr=""
  echo "[..] Waiting for tunnel to come up..."
  for i in $(seq 1 30); do
    if [ -f "$tunnel_log" ]; then
      local addr port
      addr=$(grep -oP 'RSD Address: \K\S+' "$tunnel_log" 2>/dev/null | head -1)
      port=$(grep -oP 'RSD Port: \K\S+' "$tunnel_log" 2>/dev/null | head -1)
      if [ -n "$addr" ] && [ -n "$port" ]; then
        rsd_addr="$addr $port"
        break
      fi
    fi
    sleep 1
  done

  if [ -n "$rsd_addr" ]; then
    echo "$rsd_addr" > "$RSD_FILE"
    echo "[ok] RSD address: $rsd_addr (saved to $RSD_FILE)"
  else
    echo "[warn] Could not auto-detect RSD address after 30s."
    echo "       If the tunnel printed an RSD address above, write it manually:"
    echo "       echo 'HOST PORT' > $RSD_FILE"
  fi
}

start_ble_hid() {
  echo "[..] Starting BLE HID (needs sudo)..."
  sudo true  # credentials should already be cached from start_tunnel
  sudo PYTHONUNBUFFERED=1 $BLE_PYTHON "$POC_SCRIPT" &
  BLE_PID=$!
  echo "$BLE_PID" > "$BLE_PID_FILE"

  # Wait for BLE to print "Ready."
  local ready=false
  for i in $(seq 1 15); do
    # Check if process is still alive
    if ! kill -0 "$BLE_PID" 2>/dev/null; then
      echo "[FAIL] BLE HID process died during startup"
      BLE_PID=""
      rm -f "$BLE_PID_FILE"
      return 1
    fi
    # Check for Ready message — since output goes to terminal, check /proc
    # We can't easily capture bg process stdout, so use a timeout heuristic
    if [ "$i" -ge 5 ]; then
      ready=true
      break
    fi
    sleep 1
  done

  if $ready; then
    echo "[ok] BLE HID started (pid $BLE_PID)"
    echo "     On iPhone: Settings > Bluetooth > tap \"baremobile\" to pair"
  else
    echo "[warn] BLE HID may not be ready — check output above"
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

  echo "[..] Pairing for WiFi remote access..."
  pmd3 remote pair
  echo "[ok] WiFi remote pairing complete"

  echo ""
  echo "Done. On your iPhone:"
  echo "  Settings > Privacy & Security > Developer Mode > ON > Restart"
  echo ""
  echo "After restart, run:"
  echo "  ./scripts/ios-tunnel.sh          # USB tunnel"
  echo "  ./scripts/ios-tunnel.sh --wifi   # WiFi tunnel (cable-free)"
}

cmd_check() {
  exec node test/ios/check-prerequisites.js
}

cmd_stop() {
  echo "=== Stopping iOS Bridge ==="
  local stopped=false

  if [ -f "$BLE_PID_FILE" ]; then
    local pid
    pid=$(cat "$BLE_PID_FILE")
    if sudo kill "$pid" 2>/dev/null; then
      echo "  BLE HID stopped (pid $pid)"
      stopped=true
    fi
    rm -f "$BLE_PID_FILE"
  fi

  if [ -f "$TUNNEL_PID_FILE" ]; then
    local pid
    pid=$(cat "$TUNNEL_PID_FILE")
    if sudo kill "$pid" 2>/dev/null; then
      echo "  tunnel stopped (pid $pid)"
      stopped=true
    fi
    rm -f "$TUNNEL_PID_FILE"
  fi

  rm -f "$RSD_FILE"

  if $stopped; then
    echo "Done."
  else
    echo "No running bridge found."
  fi
}

cmd_start() {
  if $WIFI_MODE; then
    echo "=== iOS Developer Bridge (WiFi) ==="
  else
    echo "=== iOS Developer Bridge ==="
    ensure_usbmuxd
    wait_for_device
    mount_developer_image
  fi
  start_tunnel

  if ! $NO_BLE; then
    start_ble_hid
  fi

  echo ""
  echo "Bridge running. Tests:"
  echo "  npm run test:ios"
  echo ""
  echo "Press Ctrl+C to stop."
  wait
}

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-ble) NO_BLE=true; shift ;;
    --wifi) WIFI_MODE=true; shift ;;
    setup) cmd_setup; exit 0 ;;
    check) cmd_check; exit 0 ;;
    stop) cmd_stop; exit 0 ;;
    start) shift; break ;;
    *) echo "Usage: $0 [--wifi] [--no-ble] [setup|check|start|stop]"; exit 1 ;;
  esac
done

cmd_start
