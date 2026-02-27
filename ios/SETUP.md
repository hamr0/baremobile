# iOS WDA Setup

> **Prefer `baremobile setup`** — the interactive wizard handles all steps below automatically, with cross-platform support (Linux, macOS, WSL). This file is for advanced/scripted use.

## Quick Start
```bash
baremobile setup     # interactive wizard — pick option 2 (from scratch) or 3 (start WDA)
baremobile ios teardown  # kill all bridge processes
```

## One-Time: Device
1. **Developer Mode** — Settings > Privacy & Security > Developer Mode > ON (reboot required)
2. **UI Automation** — Settings > Developer > Enable UI Automation > ON

## One-Time: Host (Linux)
3. `pip3.12 install pymobiledevice3`
4. AltServer-Linux from https://github.com/NyaMisty/AltServer-Linux/releases
5. `sudo dnf install avahi-compat-libdns_sd && sudo ln -s /usr/lib64/libdns_sd.so.1 /usr/lib64/libdns_sd.so`

## Every 7 Days: Re-sign WDA (free account)
```bash
./AltServer -u <UDID> -a <apple-id> -p <password> -n https://ani.sidestore.io .wda/WebDriverAgent.ipa
```
Then on device: Settings > General > VPN & Device Management > Trust

## Troubleshooting

| Problem | Fix |
|---|---|
| `InvalidService` on WDA launch | DDI not mounted — `baremobile setup` (option 3) handles this |
| `Device is not connected` | USB cable + trust computer |
| Port 8100 in use | `fuser -k 8100/tcp` or `baremobile ios teardown` |
| `invalid code signature` | Trust profile: Settings > General > VPN & Device Management |
| WDA cert expired | Re-sign (see above) |
| Tunnel auth popup doesn't appear | Run `pkexec echo test` to verify pkexec works |
