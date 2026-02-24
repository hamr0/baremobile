#!/usr/bin/env python3.12
"""iOS accessibility helper — dump elements and navigate focus.

Usage:
    python3.12 scripts/ios-ax.py --rsd HOST PORT dump
    python3.12 scripts/ios-ax.py --rsd HOST PORT focus N
"""

import argparse
import asyncio
import json
import sys

from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.accessibilityaudit import AccessibilityAudit, Direction


async def connect_rsd(host, port):
    rsd = RemoteServiceDiscoveryService((host, int(port)))
    await rsd.connect()
    return rsd


def parse_caption(caption):
    """Parse an accessibility caption into label, role, value, traits.

    iOS captions are comma-separated strings like:
        "Wi-Fi, vanCampers, Button"
        "Settings, Header"
        "Back"
    """
    if not caption:
        return {'label': '', 'role': '', 'value': None, 'traits': []}

    parts = [p.strip() for p in caption.split(', ')]

    # Known iOS accessibility roles (last matching token)
    roles = {
        'Button', 'Header', 'StaticText', 'TextField', 'SecureTextField',
        'Image', 'Cell', 'Table', 'Switch', 'Slider', 'Link',
        'NavigationBar', 'TabBar', 'Tab', 'SearchField', 'Alert',
        'Sheet', 'Toolbar', 'SegmentedControl', 'Picker', 'ScrollView',
        'PageIndicator', 'ProgressIndicator', 'ActivityIndicator',
        'Stepper', 'Map', 'WebView', 'Toggle', 'Checkbox',
        'Adjustable', 'Selected', 'Heading',
    }

    if len(parts) == 1:
        return {'label': parts[0], 'role': '', 'value': None, 'traits': []}

    # Scan from the end for a role token
    role = ''
    role_idx = len(parts)
    for i in range(len(parts) - 1, 0, -1):
        if parts[i] in roles:
            role = parts[i]
            role_idx = i
            break

    label = parts[0]
    value = None
    traits = []

    # Middle parts (between label and role) — first is value, rest are traits
    middle = parts[1:role_idx]
    if middle:
        value = middle[0]
        traits = middle[1:]

    return {'label': label, 'role': role, 'value': value, 'traits': traits}


def cmd_dump(rsd):
    """Dump all accessibility elements as JSON array."""
    elements = []
    with AccessibilityAudit(rsd) as ax:
        for i, el in enumerate(ax.iter_elements()):
            parsed = parse_caption(el.caption)
            elements.append({
                'ref': i,
                'label': parsed['label'],
                'role': parsed['role'],
                'value': parsed['value'],
                'traits': parsed['traits'],
                'caption': el.caption or '',
            })
    json.dump(elements, sys.stdout)
    sys.stdout.write('\n')


def cmd_focus(rsd, target_ref):
    """Navigate focus to element at ref index."""
    with AccessibilityAudit(rsd) as ax:
        # Reset to first element
        ax.move_focus(Direction.First)
        # Navigate forward to target
        for _ in range(target_ref):
            ax.move_focus(Direction.Next)
    json.dump({'focused': target_ref}, sys.stdout)
    sys.stdout.write('\n')


def main():
    parser = argparse.ArgumentParser(description='iOS accessibility helper')
    parser.add_argument('--rsd', nargs=2, metavar=('HOST', 'PORT'), required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('dump')
    focus_p = sub.add_parser('focus')
    focus_p.add_argument('ref', type=int)
    args = parser.parse_args()

    rsd = asyncio.run(connect_rsd(args.rsd[0], args.rsd[1]))

    if args.command == 'dump':
        cmd_dump(rsd)
    elif args.command == 'focus':
        cmd_focus(rsd, args.ref)


if __name__ == '__main__':
    main()
