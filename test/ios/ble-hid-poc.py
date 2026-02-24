#!/usr/bin/env python3
"""
BLE HID POC — Keyboard + Mouse via BlueZ D-Bus GATT server.

Presents Linux as a BLE HID keyboard/mouse to iOS.
iPhone pairs via Settings > Bluetooth > "baremobile".

Usage:
    sudo python3 test/ios/ble-hid-poc.py
    # Then type commands at the > prompt:
    #   send_string hello
    #   send_key a
    #   click
    #   move 100 200
    #   quit

Requires:
    - BlueZ 5.56+ with input plugin disabled in /etc/bluetooth/main.conf
    - python3-dbus, python3-gobject (Fedora) or dbus-python, PyGObject (pip)
    - Bluetooth adapter supporting peripheral role

Based on HeadHodge Bluez-HID-over-Gatt-Keyboard-Peripheral.
"""

import sys
import dbus
import dbus.exceptions
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

BLUEZ_SERVICE = 'org.bluez'
GATT_MANAGER_IFACE = 'org.bluez.GattManager1'
LE_ADVERTISING_MANAGER_IFACE = 'org.bluez.LEAdvertisingManager1'
DBUS_OM_IFACE = 'org.freedesktop.DBus.ObjectManager'
DBUS_PROP_IFACE = 'org.freedesktop.DBus.Properties'
GATT_SERVICE_IFACE = 'org.bluez.GattService1'
GATT_CHRC_IFACE = 'org.bluez.GattCharacteristic1'
GATT_DESC_IFACE = 'org.bluez.GattDescriptor1'
LE_ADVERTISEMENT_IFACE = 'org.bluez.LEAdvertisement1'

# HID Report Map: keyboard (Report ID 1) + mouse (Report ID 2)
REPORT_MAP = bytes([
    # --- Keyboard (Report ID 1) ---
    0x05, 0x01,        # Usage Page (Generic Desktop)
    0x09, 0x06,        # Usage (Keyboard)
    0xA1, 0x01,        # Collection (Application)
    0x85, 0x01,        #   Report ID (1)
    0x05, 0x07,        #   Usage Page (Key Codes)
    0x19, 0xE0,        #   Usage Minimum (224) - Left Control
    0x29, 0xE7,        #   Usage Maximum (231) - Right GUI
    0x15, 0x00,        #   Logical Minimum (0)
    0x25, 0x01,        #   Logical Maximum (1)
    0x75, 0x01,        #   Report Size (1)
    0x95, 0x08,        #   Report Count (8)
    0x81, 0x02,        #   Input (Data, Variable, Absolute) - Modifier byte
    0x95, 0x01,        #   Report Count (1)
    0x75, 0x08,        #   Report Size (8)
    0x81, 0x01,        #   Input (Constant) - Reserved byte
    0x95, 0x06,        #   Report Count (6)
    0x75, 0x08,        #   Report Size (8)
    0x15, 0x00,        #   Logical Minimum (0)
    0x25, 0x65,        #   Logical Maximum (101)
    0x05, 0x07,        #   Usage Page (Key Codes)
    0x19, 0x00,        #   Usage Minimum (0)
    0x29, 0x65,        #   Usage Maximum (101)
    0x81, 0x00,        #   Input (Data, Array) - Key array (6 keys)
    # LED Output Report (iOS expects this for keyboards)
    0x05, 0x08,        #   Usage Page (LEDs)
    0x19, 0x01,        #   Usage Minimum (1) - Num Lock
    0x29, 0x05,        #   Usage Maximum (5) - Kana
    0x95, 0x05,        #   Report Count (5)
    0x75, 0x01,        #   Report Size (1)
    0x91, 0x02,        #   Output (Data, Variable, Absolute) - LED bits
    0x95, 0x01,        #   Report Count (1)
    0x75, 0x03,        #   Report Size (3)
    0x91, 0x01,        #   Output (Constant) - Padding
    0xC0,              # End Collection

    # --- Mouse (Report ID 2) ---
    0x05, 0x01,        # Usage Page (Generic Desktop)
    0x09, 0x02,        # Usage (Mouse)
    0xA1, 0x01,        # Collection (Application)
    0x85, 0x02,        #   Report ID (2)
    0x09, 0x01,        #   Usage (Pointer)
    0xA1, 0x00,        #   Collection (Physical)
    0x05, 0x09,        #     Usage Page (Buttons)
    0x19, 0x01,        #     Usage Minimum (1)
    0x29, 0x03,        #     Usage Maximum (3)
    0x15, 0x00,        #     Logical Minimum (0)
    0x25, 0x01,        #     Logical Maximum (1)
    0x95, 0x03,        #     Report Count (3)
    0x75, 0x01,        #     Report Size (1)
    0x81, 0x02,        #     Input (Data, Variable, Absolute) - 3 buttons
    0x95, 0x01,        #     Report Count (1)
    0x75, 0x05,        #     Report Size (5)
    0x81, 0x01,        #     Input (Constant) - Padding
    0x05, 0x01,        #     Usage Page (Generic Desktop)
    0x09, 0x30,        #     Usage (X)
    0x09, 0x31,        #     Usage (Y)
    0x09, 0x38,        #     Usage (Wheel)
    0x15, 0x81,        #     Logical Minimum (-127)
    0x25, 0x7F,        #     Logical Maximum (127)
    0x75, 0x08,        #     Report Size (8)
    0x95, 0x03,        #     Report Count (3)
    0x81, 0x06,        #     Input (Data, Variable, Relative)
    0xC0,              #   End Collection (Physical)
    0xC0,              # End Collection
])

# USB HID keycode lookup
CHAR_TO_KEYCODE = {}
for i, c in enumerate('abcdefghijklmnopqrstuvwxyz'):
    CHAR_TO_KEYCODE[c] = (0, 0x04 + i)
for i, c in enumerate('1234567890'):
    CHAR_TO_KEYCODE[c] = (0, 0x1E + i)
CHAR_TO_KEYCODE[' '] = (0, 0x2C)
CHAR_TO_KEYCODE['\n'] = (0, 0x28)
CHAR_TO_KEYCODE['\t'] = (0, 0x2B)
CHAR_TO_KEYCODE['-'] = (0, 0x2D)
CHAR_TO_KEYCODE['='] = (0, 0x2E)
CHAR_TO_KEYCODE['['] = (0, 0x2F)
CHAR_TO_KEYCODE[']'] = (0, 0x30)
CHAR_TO_KEYCODE['\\'] = (0, 0x31)
CHAR_TO_KEYCODE[';'] = (0, 0x33)
CHAR_TO_KEYCODE["'"] = (0, 0x34)
CHAR_TO_KEYCODE['`'] = (0, 0x35)
CHAR_TO_KEYCODE[','] = (0, 0x36)
CHAR_TO_KEYCODE['.'] = (0, 0x37)
CHAR_TO_KEYCODE['/'] = (0, 0x38)

# Named special keys (HID usage IDs)
SPECIAL_KEYS = {
    'enter': (0, 0x28),       # Return/Enter
    'return': (0, 0x28),
    'escape': (0, 0x29),
    'esc': (0, 0x29),
    'backspace': (0, 0x2A),
    'delete': (0, 0x2A),
    'tab': (0, 0x2B),
    'space': (0, 0x2C),
    'capslock': (0, 0x39),
    'right': (0, 0x4F),       # Right Arrow
    'left': (0, 0x50),        # Left Arrow
    'down': (0, 0x51),        # Down Arrow
    'up': (0, 0x52),          # Up Arrow
    'home': (0, 0x4A),        # Home
    'end': (0, 0x4D),         # End
    'pageup': (0, 0x4B),
    'pagedown': (0, 0x4E),
    'f1': (0, 0x3A), 'f2': (0, 0x3B), 'f3': (0, 0x3C), 'f4': (0, 0x3D),
    'f5': (0, 0x3E), 'f6': (0, 0x3F), 'f7': (0, 0x40), 'f8': (0, 0x41),
    'f9': (0, 0x42), 'f10': (0, 0x43), 'f11': (0, 0x44), 'f12': (0, 0x45),
    # Modifier combos for VoiceOver (Caps Lock = VO key on iOS)
    'vo+space': (0x39, 0x2C),     # placeholder — handled specially below
}

SHIFT_CHARS = {
    'A': 'a', 'B': 'b', 'C': 'c', 'D': 'd', 'E': 'e', 'F': 'f', 'G': 'g',
    'H': 'h', 'I': 'i', 'J': 'j', 'K': 'k', 'L': 'l', 'M': 'm', 'N': 'n',
    'O': 'o', 'P': 'p', 'Q': 'q', 'R': 'r', 'S': 's', 'T': 't', 'U': 'u',
    'V': 'v', 'W': 'w', 'X': 'x', 'Y': 'y', 'Z': 'z',
    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
    '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
    '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\',
    ':': ';', '"': "'", '~': '`', '<': ',', '>': '.', '?': '/',
}

# --- D-Bus base classes (matches BlueZ example-gatt-server pattern) ---

class Application(dbus.service.Object):
    PATH = '/org/bluez/baremobile'

    def __init__(self, bus):
        self.path = self.PATH
        self.services = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_service(self, service):
        self.services.append(service)

    @dbus.service.method(DBUS_OM_IFACE, out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        response = {}
        for service in self.services:
            response[service.get_path()] = service.get_properties()
            for chrc in service.get_characteristics():
                response[chrc.get_path()] = chrc.get_properties()
                for desc in chrc.get_descriptors():
                    response[desc.get_path()] = desc.get_properties()
        return response


class Service(dbus.service.Object):
    PATH_BASE = '/org/bluez/baremobile/service'

    def __init__(self, bus, index, uuid, primary):
        self.path = self.PATH_BASE + str(index)
        self.bus = bus
        self.uuid = uuid
        self.primary = primary
        self.characteristics = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_properties(self):
        return {
            GATT_SERVICE_IFACE: {
                'UUID': self.uuid,
                'Primary': self.primary,
                'Characteristics': dbus.Array(
                    self.get_characteristic_paths(), signature='o'),
            }
        }

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_characteristic(self, chrc):
        self.characteristics.append(chrc)

    def get_characteristics(self):
        return self.characteristics

    def get_characteristic_paths(self):
        return [c.get_path() for c in self.characteristics]

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != GATT_SERVICE_IFACE:
            raise dbus.exceptions.DBusException(
                'org.freedesktop.DBus.Error.InvalidArgs',
                f'No such interface: {interface}')
        return self.get_properties()[GATT_SERVICE_IFACE]


class Characteristic(dbus.service.Object):

    def __init__(self, bus, index, uuid, flags, service):
        self.path = service.path + '/char' + str(index)
        self.bus = bus
        self.uuid = uuid
        self.service = service
        self.flags = flags
        self.descriptors = []
        self.value = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_properties(self):
        return {
            GATT_CHRC_IFACE: {
                'Service': self.service.get_path(),
                'UUID': self.uuid,
                'Flags': dbus.Array(self.flags, signature='s'),
                'Descriptors': dbus.Array(
                    self.get_descriptor_paths(), signature='o'),
            }
        }

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_descriptor(self, desc):
        self.descriptors.append(desc)

    def get_descriptors(self):
        return self.descriptors

    def get_descriptor_paths(self):
        return [d.get_path() for d in self.descriptors]

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != GATT_CHRC_IFACE:
            raise dbus.exceptions.DBusException(
                'org.freedesktop.DBus.Error.InvalidArgs',
                f'No such interface: {interface}')
        return self.get_properties()[GATT_CHRC_IFACE]

    @dbus.service.method(GATT_CHRC_IFACE, in_signature='a{sv}', out_signature='ay')
    def ReadValue(self, options):
        print(f'  [ReadValue] {self.uuid} -> {list(self.value)}')
        return self.value

    @dbus.service.method(GATT_CHRC_IFACE, in_signature='aya{sv}')
    def WriteValue(self, value, options):
        print(f'  [WriteValue] {self.uuid} <- {list(value)}')
        self.value = value

    @dbus.service.method(GATT_CHRC_IFACE)
    def StartNotify(self):
        pass

    @dbus.service.method(GATT_CHRC_IFACE)
    def StopNotify(self):
        pass

    @dbus.service.signal(DBUS_PROP_IFACE, signature='sa{sv}as')
    def PropertiesChanged(self, interface, changed, invalidated):
        pass


class Descriptor(dbus.service.Object):

    def __init__(self, bus, index, uuid, flags, chrc):
        self.path = chrc.path + '/desc' + str(index)
        self.bus = bus
        self.uuid = uuid
        self.flags = flags
        self.chrc = chrc
        self.value = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_properties(self):
        return {
            GATT_DESC_IFACE: {
                'Characteristic': self.chrc.get_path(),
                'UUID': self.uuid,
                'Flags': dbus.Array(self.flags, signature='s'),
            }
        }

    def get_path(self):
        return dbus.ObjectPath(self.path)

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != GATT_DESC_IFACE:
            raise dbus.exceptions.DBusException(
                'org.freedesktop.DBus.Error.InvalidArgs',
                f'No such interface: {interface}')
        return self.get_properties()[GATT_DESC_IFACE]

    @dbus.service.method(GATT_DESC_IFACE, in_signature='a{sv}', out_signature='ay')
    def ReadValue(self, options):
        print(f'  [Desc ReadValue] {self.uuid} -> {list(self.value)}')
        return self.value

    @dbus.service.method(GATT_DESC_IFACE, in_signature='aya{sv}')
    def WriteValue(self, value, options):
        print(f'  [Desc WriteValue] {self.uuid} <- {list(value)}')
        self.value = value


# --- HID Service ---

class HIDService(Service):
    UUID = '00001812-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index):
        Service.__init__(self, bus, index, self.UUID, True)
        self.add_characteristic(ProtocolModeChrc(bus, 0, self))
        self.add_characteristic(HIDInfoChrc(bus, 1, self))
        self.add_characteristic(ControlPointChrc(bus, 2, self))
        self.add_characteristic(ReportMapChrc(bus, 3, self))
        # Keyboard input report (Report ID 1, 8 bytes)
        self.kb_report = ReportChrc(bus, 4, self, report_id=1, size=8)
        self.add_characteristic(self.kb_report)
        # Mouse input report (Report ID 2, 4 bytes)
        self.mouse_report = ReportChrc(bus, 5, self, report_id=2, size=4)
        self.add_characteristic(self.mouse_report)
        # LED output report (Report ID 1, type=Output)
        self.led_report = OutputReportChrc(bus, 6, self)
        self.add_characteristic(self.led_report)


class ProtocolModeChrc(Characteristic):
    UUID = '00002a4e-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        Characteristic.__init__(self, bus, index, self.UUID,
                                ['read', 'write-without-response'], service)
        self.value = dbus.Array([dbus.Byte(0x01)], signature='y')


class HIDInfoChrc(Characteristic):
    UUID = '00002a4a-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        Characteristic.__init__(self, bus, index, self.UUID, ['read'], service)
        # bcdHID=1.11, bCountryCode=0, Flags=0x02 (normally connectable)
        self.value = dbus.Array([dbus.Byte(0x11), dbus.Byte(0x01),
                                 dbus.Byte(0x00), dbus.Byte(0x02)], signature='y')


class ControlPointChrc(Characteristic):
    UUID = '00002a4c-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        Characteristic.__init__(self, bus, index, self.UUID,
                                ['write-without-response'], service)


class ReportMapChrc(Characteristic):
    UUID = '00002a4b-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        Characteristic.__init__(self, bus, index, self.UUID, ['secure-read'], service)
        self.value = dbus.Array([dbus.Byte(b) for b in REPORT_MAP], signature='y')


class ReportReferenceDesc(Descriptor):
    UUID = '00002908-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, chrc, report_id, report_type=1):
        Descriptor.__init__(self, bus, index, self.UUID, ['secure-read'], chrc)
        self.value = dbus.Array([dbus.Byte(report_id), dbus.Byte(report_type)],
                                signature='y')


class ReportChrc(Characteristic):
    UUID = '00002a4d-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service, report_id, size=8):
        Characteristic.__init__(self, bus, index, self.UUID,
                                ['secure-read', 'notify'], service)
        self.report_id = report_id
        self.notifying = False
        self.add_descriptor(ReportReferenceDesc(bus, 0, self, report_id, report_type=1))
        self.value = dbus.Array([dbus.Byte(0)] * size, signature='y')
        self.label = 'KB' if report_id == 1 else 'MOUSE'

    def StartNotify(self):
        self.notifying = True
        print(f'  Report {self.report_id} ({self.label}): notifications ON')

    def StopNotify(self):
        self.notifying = False
        print(f'  Report {self.report_id} ({self.label}): notifications OFF')

    def send_report(self, data):
        self.value = dbus.Array([dbus.Byte(b) for b in data], signature='y')
        print(f'  [{self.label}] notify: {[hex(b) for b in data]}  notifying={self.notifying}')
        self.PropertiesChanged(GATT_CHRC_IFACE, {'Value': self.value}, [])


class OutputReportChrc(Characteristic):
    """Output Report for LED indicators — iOS writes Caps Lock etc. here."""
    UUID = '00002a4d-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        Characteristic.__init__(self, bus, index, self.UUID,
                                ['secure-read', 'write', 'write-without-response'], service)
        self.add_descriptor(ReportReferenceDesc(bus, 0, self, 1, report_type=2))  # type=2 = Output, Report ID 1 (keyboard)
        self.value = dbus.Array([dbus.Byte(0)], signature='y')

    def WriteValue(self, value, options):
        self.value = value
        print(f'  [LED] write: {[hex(int(b)) for b in value]}')


# --- Device Information Service ---

class DeviceInfoService(Service):
    UUID = '0000180a-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index):
        Service.__init__(self, bus, index, self.UUID, True)
        self.add_characteristic(ManufacturerChrc(bus, 0, self))
        self.add_characteristic(PnPIDChrc(bus, 1, self))


class ManufacturerChrc(Characteristic):
    UUID = '00002a29-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        Characteristic.__init__(self, bus, index, self.UUID, ['read'], service)
        self.value = dbus.Array([dbus.Byte(c) for c in b'baremobile'], signature='y')


class PnPIDChrc(Characteristic):
    UUID = '00002a50-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        Characteristic.__init__(self, bus, index, self.UUID, ['read'], service)
        self.value = dbus.Array([dbus.Byte(b) for b in
                                 bytes([0x02, 0xAC, 0x05, 0x01, 0x00, 0x01, 0x00])],
                                signature='y')


# --- Battery Service ---

class BatteryService(Service):
    UUID = '0000180f-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index):
        Service.__init__(self, bus, index, self.UUID, True)
        self.add_characteristic(BatteryLevelChrc(bus, 0, self))


class BatteryLevelChrc(Characteristic):
    UUID = '00002a19-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        Characteristic.__init__(self, bus, index, self.UUID, ['read', 'notify'], service)
        self.value = dbus.Array([dbus.Byte(100)], signature='y')


# --- BLE Advertisement ---

class Advertisement(dbus.service.Object):
    PATH = '/org/bluez/baremobile/adv0'

    def __init__(self, bus):
        self.path = self.PATH
        self.bus = bus
        dbus.service.Object.__init__(self, bus, self.path)

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != LE_ADVERTISEMENT_IFACE:
            return {}
        return {
            'Type': 'peripheral',
            'LocalName': dbus.String('baremobile'),
            'ServiceUUIDs': dbus.Array([HIDService.UUID], signature='s'),
            'Appearance': dbus.UInt16(0x03C0),  # Generic HID (combo keyboard+mouse)
            'Includes': dbus.Array(['tx-power'], signature='s'),
        }

    @dbus.service.method(LE_ADVERTISEMENT_IFACE, in_signature='', out_signature='')
    def Release(self):
        pass


# --- Input functions ---

def send_key(hid_service, char):
    # Named special keys (enter, space, right, left, etc.)
    if char.lower() in SPECIAL_KEYS:
        modifier, keycode = SPECIAL_KEYS[char.lower()]
        hid_service.kb_report.send_report([modifier, 0x00, keycode, 0, 0, 0, 0, 0])
        GLib.timeout_add(80, lambda: hid_service.kb_report.send_report([0] * 8) or False)
        return
    if char in SHIFT_CHARS:
        base = SHIFT_CHARS[char]
        modifier = 0x02  # Left Shift
    elif char in CHAR_TO_KEYCODE:
        base = char
        modifier = 0
    else:
        print(f'  Unknown character: {char!r}')
        return
    _, keycode = CHAR_TO_KEYCODE[base]
    # Key down
    hid_service.kb_report.send_report([modifier, 0x00, keycode, 0, 0, 0, 0, 0])
    # Key up after 80ms
    GLib.timeout_add(80, lambda: hid_service.kb_report.send_report([0] * 8) or False)


def send_hid(hid_service, modifier, keycode):
    """Send raw HID report: modifier byte + keycode."""
    hid_service.kb_report.send_report([modifier, 0x00, keycode, 0, 0, 0, 0, 0])
    GLib.timeout_add(80, lambda: hid_service.kb_report.send_report([0] * 8) or False)


def send_string(hid_service, text):
    for i, char in enumerate(text):
        GLib.timeout_add(i * 200, lambda c=char: send_key(hid_service, c) or False)
    print(f'  Sending {len(text)} chars...')


def move_mouse(hid_service, dx, dy):
    """Move mouse by sending rapid small-step reports (like a real mouse sensor).
    iOS clamps single-report movement — must send many small deltas at high frequency."""
    STEP = 50  # units per report — larger steps for slow tracking settings
    INTERVAL = 8  # ms between reports (~125Hz, matches real mouse polling rate)
    steps = max(abs(dx), abs(dy), 1) // STEP or 1
    sx = dx / steps if steps else 0
    sy = dy / steps if steps else 0
    for i in range(steps):
        step_dx = int(round(sx))
        step_dy = int(round(sy))
        step_dx = max(-127, min(127, step_dx))
        step_dy = max(-127, min(127, step_dy))
        GLib.timeout_add(i * INTERVAL, lambda sdx=step_dx, sdy=step_dy:
                         hid_service.mouse_report.send_report(
                             [0x00, sdx & 0xFF, sdy & 0xFF, 0x00]) or False)
    # Zero report after last step
    GLib.timeout_add(steps * INTERVAL, lambda:
                     hid_service.mouse_report.send_report([0, 0, 0, 0]) or False)


def click(hid_service):
    hid_service.mouse_report.send_report([0x01, 0x00, 0x00, 0x00])
    GLib.timeout_add(80, lambda: hid_service.mouse_report.send_report([0, 0, 0, 0]) or False)


def scroll(hid_service, amount):
    """Scroll wheel: negative = scroll down, positive = scroll up."""
    STEP = 1
    INTERVAL = 50  # ms between scroll reports
    steps = abs(amount)
    direction = 1 if amount > 0 else -1
    for i in range(steps):
        val = direction * STEP
        GLib.timeout_add(i * INTERVAL, lambda v=val:
                         hid_service.mouse_report.send_report(
                             [0x00, 0x00, 0x00, v & 0xFF]) or False)
    GLib.timeout_add(steps * INTERVAL, lambda:
                     hid_service.mouse_report.send_report([0, 0, 0, 0]) or False)


# --- Main ---

AGENT_IFACE = 'org.bluez.Agent1'
AGENT_MANAGER_IFACE = 'org.bluez.AgentManager1'


class PairingAgent(dbus.service.Object):
    """Auto-accept pairing agent — handles bonding requests from iOS."""
    PATH = '/org/bluez/baremobile/agent'

    def __init__(self, bus):
        dbus.service.Object.__init__(self, bus, self.PATH)

    @dbus.service.method(AGENT_IFACE, in_signature='', out_signature='')
    def Release(self):
        pass

    @dbus.service.method(AGENT_IFACE, in_signature='os', out_signature='')
    def AuthorizeService(self, device, uuid):
        print(f'  [Agent] Authorizing service {uuid} for {device}')

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='')
    def RequestAuthorization(self, device):
        print(f'  [Agent] Authorized {device}')

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='u')
    def RequestPasskey(self, device):
        print(f'  [Agent] Passkey request from {device} — returning 0')
        return dbus.UInt32(0)

    @dbus.service.method(AGENT_IFACE, in_signature='ouq', out_signature='')
    def DisplayPasskey(self, device, passkey, entered):
        print(f'  [Agent] Passkey: {passkey:06d}')

    @dbus.service.method(AGENT_IFACE, in_signature='ou', out_signature='')
    def RequestConfirmation(self, device, passkey):
        print(f'  [Agent] Confirming passkey {passkey:06d} for {device}')

    @dbus.service.method(AGENT_IFACE, in_signature='o', out_signature='s')
    def RequestPinCode(self, device):
        return '0000'

    @dbus.service.method(AGENT_IFACE, in_signature='', out_signature='')
    def Cancel(self):
        print('  [Agent] Pairing cancelled')


def find_adapter(bus):
    remote_om = dbus.Interface(bus.get_object(BLUEZ_SERVICE, '/'), DBUS_OM_IFACE)
    objects = remote_om.GetManagedObjects()
    for path, interfaces in objects.items():
        if GATT_MANAGER_IFACE in interfaces:
            return path
    return None


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()

    adapter_path = find_adapter(bus)
    if not adapter_path:
        print('ERROR: No Bluetooth adapter with GATT Manager support')
        sys.exit(1)
    print(f'Adapter: {adapter_path}')

    # Set adapter name
    adapter_props = dbus.Interface(
        bus.get_object(BLUEZ_SERVICE, adapter_path), DBUS_PROP_IFACE)
    adapter_props.Set('org.bluez.Adapter1', 'Alias', 'baremobile')
    adapter_props.Set('org.bluez.Adapter1', 'Powered', dbus.Boolean(True))
    adapter_props.Set('org.bluez.Adapter1', 'Pairable', dbus.Boolean(True))
    # Do NOT set Discoverable=True — that enables Classic BT which creates a
    # duplicate entry on iPhone. BLE discovery uses the LE advertisement only.
    adapter_props.Set('org.bluez.Adapter1', 'Discoverable', dbus.Boolean(False))

    # Register pairing agent — auto-accepts bonding from iPhone
    agent = PairingAgent(bus)
    agent_manager = dbus.Interface(
        bus.get_object(BLUEZ_SERVICE, '/org/bluez'), AGENT_MANAGER_IFACE)
    agent_manager.RegisterAgent(agent.PATH, 'KeyboardDisplay')
    agent_manager.RequestDefaultAgent(agent.PATH)
    print('Pairing agent registered (auto-accept)')

    # Build GATT application
    app = Application(bus)
    hid_service = HIDService(bus, 0)
    app.add_service(hid_service)
    app.add_service(DeviceInfoService(bus, 1))
    app.add_service(BatteryService(bus, 2))

    gatt_manager = dbus.Interface(
        bus.get_object(BLUEZ_SERVICE, adapter_path), GATT_MANAGER_IFACE)
    adv_manager = dbus.Interface(
        bus.get_object(BLUEZ_SERVICE, adapter_path), LE_ADVERTISING_MANAGER_IFACE)
    adv = Advertisement(bus)

    mainloop = GLib.MainLoop()

    def on_app_registered():
        print('GATT application registered OK')

    def on_app_error(error):
        print(f'ERROR registering GATT app: {error}')
        mainloop.quit()

    def on_adv_registered():
        print('Advertisement registered OK')
        print('On iPhone: Settings > Bluetooth > tap "baremobile" to pair')

    def on_adv_error(error):
        print(f'ERROR registering advertisement: {error}')
        mainloop.quit()

    gatt_manager.RegisterApplication(
        app.get_path(), {},
        reply_handler=on_app_registered,
        error_handler=on_app_error)

    adv_manager.RegisterAdvertisement(
        adv.path, {},
        reply_handler=on_adv_registered,
        error_handler=on_adv_error)

    # Interactive command prompt via GLib IO watch
    def handle_command(line):
        parts = line.strip().split()
        if not parts:
            return
        cmd = parts[0]
        if cmd == 'send_key' and len(parts) >= 2:
            send_key(hid_service, parts[1])
        elif cmd == 'send_string' and len(parts) >= 2:
            send_string(hid_service, ' '.join(parts[1:]))
        elif cmd == 'click':
            click(hid_service)
        elif cmd == 'send_hid' and len(parts) >= 3:
            send_hid(hid_service, int(parts[1], 0), int(parts[2], 0))
        elif cmd == 'move' and len(parts) >= 3:
            move_mouse(hid_service, int(parts[1]), int(parts[2]))
        elif cmd == 'scroll' and len(parts) >= 2:
            scroll(hid_service, int(parts[1]))
        elif cmd in ('quit', 'exit', 'q'):
            mainloop.quit()
        elif cmd == 'help':
            print('  send_key <char|name> | send_hid <mod> <keycode> | send_string <text>')
            print('  click | move <dx> <dy> | scroll <amount> | quit')
            print('  Named keys: enter, space, right, left, up, down, escape, tab, capslock, home, end, f1-f12')
        else:
            print(f'  Unknown: {cmd}. Type "help" for commands.')

    def watch_stdin(source, condition):
        if condition & GLib.IOCondition.HUP:
            return False
        line = sys.stdin.readline()
        if line:
            handle_command(line)
            sys.stdout.write('> ')
            sys.stdout.flush()
        return True

    GLib.io_add_watch(sys.stdin, GLib.IOCondition.IN | GLib.IOCondition.HUP, watch_stdin)

    print('Ready. Type commands at > prompt (or "help").')
    print('> ', end='', flush=True)

    try:
        mainloop.run()
    except KeyboardInterrupt:
        print('\nStopping...')


if __name__ == '__main__':
    main()
