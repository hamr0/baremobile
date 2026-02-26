#!/bin/bash
# Kill iOS WDA session processes
# Tunnel runs as root (pkexec), so we need elevated kill for it.
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

if [ -f /tmp/baremobile-ios-pids ]; then
  read -r TUNNEL WDA FWD < /tmp/baremobile-ios-pids
  echo "Stopping tunnel ($TUNNEL), WDA ($WDA), forward ($FWD)..."
  # Tunnel is root-owned (started via pkexec) — need pkexec to kill
  pkexec kill -9 "$TUNNEL" 2>/dev/null || kill "$TUNNEL" 2>/dev/null || true
  kill "$WDA" 2>/dev/null || true
  kill "$FWD" 2>/dev/null || true
  rm -f /tmp/baremobile-ios-pids
  echo -e "${GREEN}✓${NC} PID-based cleanup done."
else
  echo "No PID file found. Killing by pattern..."
  # Tunnel processes run as root
  pkexec kill -9 $(pgrep -f "pymobiledevice3.*start-tunnel" 2>/dev/null) 2>/dev/null || true
  pkill -f "XCUITestService" 2>/dev/null || true
  pkill -f "pymobiledevice3.*usbmux forward 8100" 2>/dev/null || true
  fuser -k 8100/tcp 2>/dev/null || true
  echo -e "${GREEN}✓${NC} Pattern-based cleanup done."
fi

# Verify
REMAINING=$(ps aux | grep -E 'pymobiledevice3.*(start-tunnel|forward 8100)|XCUITestService' | grep -v grep | wc -l)
if [ "$REMAINING" -eq 0 ]; then
  echo -e "${GREEN}✓${NC} All iOS processes stopped."
else
  echo -e "${RED}!${NC} $REMAINING processes still running — may need manual cleanup."
fi
