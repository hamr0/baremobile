#!/usr/bin/env python3.12
"""
BLE HID POC — Keyboard + Mouse via BlueZ D-Bus GATT server.

Presents Linux as a BLE HID keyboard/mouse to iOS.
iPhone pairs via Settings > Bluetooth > "baremobile".

Usage:
    sudo python3.12 test/ios/ble-hid-poc.py                  # start GATT server + advertise
    sudo python3.12 test/ios/ble-hid-poc.py send_key a        # send single key
    sudo python3.12 test/ios/ble-hid-poc.py send_string hello  # send string
    sudo python3.12 test/ios/ble-hid-poc.py click              # mouse click at cursor
    sudo python3.12 test/ios/ble-hid-poc.py move 100 200       # move mouse dx dy

Requires:
    - BlueZ 5.56+ with input plugin disabled
    - python3-dbus, python3-gobject (Fedora) or dbus-python, PyGObject (pip)
    - Bluetooth adapter supporting peripheral role

Based on HeadHodge HOGP keyboard gist.
"""

import sys
import dbus
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

# HID Report Map: combined keyboard + mouse
# Keyboard: 8 bytes (modifier, reserved, 6 keys)
# Mouse: 4 bytes (buttons, X, Y, wheel)
REPORT_MAP = bytes([
    # Keyboard (Report ID 1)
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
    0xC0,              # End Collection

    # Mouse (Report ID 2)
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

# USB HID keycode lookup (lowercase ASCII → HID keycode)
CHAR_TO_KEYCODE = {}
for i, c in enumerate('abcdefghijklmnopqrstuvwxyz'):
    CHAR_TO_KEYCODE[c] = (0, 0x04 + i)  # (modifier, keycode)
for i, c in enumerate('1234567890'):
    CHAR_TO_KEYCODE[c] = (0, 0x1E + i)
CHAR_TO_KEYCODE[' '] = (0, 0x2C)   # space
CHAR_TO_KEYCODE['\n'] = (0, 0x28)  # enter
CHAR_TO_KEYCODE['\t'] = (0, 0x2B)  # tab
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

# Shifted characters
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

# --- D-Bus helper base classes ---

class Application(dbus.service.Object):
    """GATT Application — container for services."""

    PATH = '/org/bluez/baremobile'

    def __init__(self, bus):
        self.path = self.PATH
        self.services = []
        dbus.service.Object.__init__(self, bus, self.path)

    def add_service(self, service):
        self.services.append(service)

    @dbus.service.method(DBUS_OM_IFACE, out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        response = {}
        for service in self.services:
            response[service.get_path()] = service.get_properties()
            for chrc in service.characteristics:
                response[chrc.get_path()] = chrc.get_properties()
                for desc in chrc.descriptors:
                    response[desc.get_path()] = desc.get_properties()
        return response


class Service(dbus.service.Object):
    """GATT Service base."""

    def __init__(self, bus, index, uuid, primary=True):
        self.path = f'{Application.PATH}/service{index}'
        self.bus = bus
        self.uuid = uuid
        self.primary = primary
        self.characteristics = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_characteristic(self, chrc):
        self.characteristics.append(chrc)

    def get_properties(self):
        return {
            GATT_SERVICE_IFACE: {
                'UUID': self.uuid,
                'Primary': self.primary,
                'Characteristics': dbus.Array(
                    [c.get_path() for c in self.characteristics],
                    signature='o'
                ),
            }
        }

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != GATT_SERVICE_IFACE:
            raise dbus.exceptions.DBusException('org.freedesktop.DBus.Error.InvalidArgs')
        return self.get_properties()[GATT_SERVICE_IFACE]


class Characteristic(dbus.service.Object):
    """GATT Characteristic base."""

    def __init__(self, bus, index, uuid, flags, service):
        self.path = f'{service.path}/char{index}'
        self.bus = bus
        self.uuid = uuid
        self.flags = flags
        self.service = service
        self.descriptors = []
        self.value = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_descriptor(self, desc):
        self.descriptors.append(desc)

    def get_properties(self):
        return {
            GATT_CHRC_IFACE: {
                'Service': self.service.get_path(),
                'UUID': self.uuid,
                'Flags': self.flags,
                'Descriptors': dbus.Array(
                    [d.get_path() for d in self.descriptors],
                    signature='o'
                ),
            }
        }

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != GATT_CHRC_IFACE:
            raise dbus.exceptions.DBusException('org.freedesktop.DBus.Error.InvalidArgs')
        return self.get_properties()[GATT_CHRC_IFACE]

    @dbus.service.method(GATT_CHRC_IFACE, in_signature='a{sv}', out_signature='ay')
    def ReadValue(self, options):
        return self.value

    @dbus.service.method(GATT_CHRC_IFACE, in_signature='aya{sv}')
    def WriteValue(self, value, options):
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
    """GATT Descriptor base."""

    def __init__(self, bus, index, uuid, flags, chrc):
        self.path = f'{chrc.path}/desc{index}'
        self.bus = bus
        self.uuid = uuid
        self.flags = flags
        self.chrc = chrc
        self.value = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def get_properties(self):
        return {
            GATT_DESC_IFACE: {
                'Characteristic': self.chrc.get_path(),
                'UUID': self.uuid,
                'Flags': self.flags,
            }
        }

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != GATT_DESC_IFACE:
            raise dbus.exceptions.DBusException('org.freedesktop.DBus.Error.InvalidArgs')
        return self.get_properties()[GATT_DESC_IFACE]

    @dbus.service.method(GATT_DESC_IFACE, in_signature='a{sv}', out_signature='ay')
    def ReadValue(self, options):
        return self.value

    @dbus.service.method(GATT_DESC_IFACE, in_signature='aya{sv}')
    def WriteValue(self, value, options):
        self.value = value


# --- HID Service implementation ---

class HIDService(Service):
    """HID Service (0x1812) — keyboard + mouse."""

    UUID = '00001812-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index):
        super().__init__(bus, index, self.UUID, True)
        # Protocol Mode (0x2A4E) — Report Protocol
        self.protocol_mode = ProtocolModeChrc(bus, 0, self)
        self.add_characteristic(self.protocol_mode)
        # HID Information (0x2A4A)
        self.hid_info = HIDInfoChrc(bus, 1, self)
        self.add_characteristic(self.hid_info)
        # Report Map (0x2A4B)
        self.report_map = ReportMapChrc(bus, 2, self)
        self.add_characteristic(self.report_map)
        # HID Control Point (0x2A4C)
        self.control_point = HIDControlPointChrc(bus, 3, self)
        self.add_characteristic(self.control_point)
        # Keyboard Report (0x2A4D, Report ID 1)
        self.kb_report = ReportChrc(bus, 4, self, report_id=1)
        self.add_characteristic(self.kb_report)
        # Mouse Report (0x2A4D, Report ID 2)
        self.mouse_report = ReportChrc(bus, 5, self, report_id=2)
        self.add_characteristic(self.mouse_report)


class ProtocolModeChrc(Characteristic):
    UUID = '00002a4e-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        super().__init__(bus, index, self.UUID,
                         ['read', 'write-without-response'], service)
        self.value = dbus.Array([dbus.Byte(0x01)], signature='y')  # Report Protocol


class HIDInfoChrc(Characteristic):
    UUID = '00002a4a-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        super().__init__(bus, index, self.UUID, ['read'], service)
        # bcdHID=1.11, bCountryCode=0, Flags=0x02 (normally connectable)
        self.value = dbus.Array([dbus.Byte(0x11), dbus.Byte(0x01),
                                 dbus.Byte(0x00), dbus.Byte(0x02)], signature='y')


class ReportMapChrc(Characteristic):
    UUID = '00002a4b-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        super().__init__(bus, index, self.UUID, ['read'], service)
        self.value = dbus.Array([dbus.Byte(b) for b in REPORT_MAP], signature='y')


class HIDControlPointChrc(Characteristic):
    UUID = '00002a4c-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        super().__init__(bus, index, self.UUID, ['write-without-response'], service)


class ReportReferenceDesc(Descriptor):
    """Report Reference Descriptor (0x2908)."""
    UUID = '00002908-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, chrc, report_id, report_type=1):
        super().__init__(bus, index, self.UUID, ['read'], chrc)
        # report_type: 1=Input, 2=Output, 3=Feature
        self.value = dbus.Array([dbus.Byte(report_id), dbus.Byte(report_type)],
                                signature='y')


class ReportChrc(Characteristic):
    """HID Report characteristic (0x2A4D) with Report Reference descriptor."""
    UUID = '00002a4d-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service, report_id):
        super().__init__(bus, index, self.UUID,
                         ['read', 'notify', 'write'], service)
        self.report_id = report_id
        self.notifying = False
        ref_desc = ReportReferenceDesc(bus, 0, self, report_id)
        self.add_descriptor(ref_desc)
        if report_id == 1:
            self.value = dbus.Array([dbus.Byte(0)] * 8, signature='y')  # keyboard: 8 bytes
        else:
            self.value = dbus.Array([dbus.Byte(0)] * 4, signature='y')  # mouse: 4 bytes

    def StartNotify(self):
        self.notifying = True

    def StopNotify(self):
        self.notifying = False

    def send_report(self, data):
        self.value = dbus.Array([dbus.Byte(b) for b in data], signature='y')
        self.PropertiesChanged(GATT_CHRC_IFACE, {'Value': self.value}, [])


# --- Device Information Service ---

class DeviceInfoService(Service):
    UUID = '0000180a-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index):
        super().__init__(bus, index, self.UUID, True)
        self.add_characteristic(ManufacturerChrc(bus, 0, self))
        self.add_characteristic(PnPIDChrc(bus, 1, self))


class ManufacturerChrc(Characteristic):
    UUID = '00002a29-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        super().__init__(bus, index, self.UUID, ['read'], service)
        self.value = dbus.Array([dbus.Byte(c) for c in b'baremobile'], signature='y')


class PnPIDChrc(Characteristic):
    UUID = '00002a50-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        super().__init__(bus, index, self.UUID, ['read'], service)
        # Vendor ID Source=0x02 (USB), Vendor ID=0x05AC (Apple-compatible),
        # Product ID=0x0001, Version=0x0001
        self.value = dbus.Array([dbus.Byte(b) for b in
                                 bytes([0x02, 0xAC, 0x05, 0x01, 0x00, 0x01, 0x00])],
                                signature='y')


# --- Battery Service ---

class BatteryService(Service):
    UUID = '0000180f-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index):
        super().__init__(bus, index, self.UUID, True)
        self.add_characteristic(BatteryLevelChrc(bus, 0, self))


class BatteryLevelChrc(Characteristic):
    UUID = '00002a19-0000-1000-8000-00805f9b34fb'

    def __init__(self, bus, index, service):
        super().__init__(bus, index, self.UUID, ['read', 'notify'], service)
        self.value = dbus.Array([dbus.Byte(100)], signature='y')  # 100%


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
            'Appearance': dbus.UInt16(0x03C1),  # Keyboard
            'Includes': dbus.Array(['tx-power'], signature='s'),
        }

    @dbus.service.method(LE_ADVERTISEMENT_IFACE, in_signature='', out_signature='')
    def Release(self):
        pass


# --- Input functions ---

def send_key(hid_service, char):
    """Send a single character as a keyboard HID report."""
    if char in SHIFT_CHARS:
        base = SHIFT_CHARS[char]
        modifier = 0x02  # Left Shift
    elif char in CHAR_TO_KEYCODE:
        base = char
        modifier = 0
    else:
        print(f'Unknown character: {char!r}')
        return
    _, keycode = CHAR_TO_KEYCODE[base]
    # Key down
    hid_service.kb_report.send_report([modifier, 0x00, keycode, 0, 0, 0, 0, 0])
    # Key up (small delay handled by GLib idle)
    GLib.timeout_add(20, lambda: hid_service.kb_report.send_report([0] * 8) or False)


def send_string(hid_service, text):
    """Send a string character by character with 50ms delays."""
    for i, char in enumerate(text):
        GLib.timeout_add(i * 70, lambda c=char: send_key(hid_service, c) or False)


def move_mouse(hid_service, dx, dy):
    """Send relative mouse movement. dx/dy clamped to -127..127 per report."""
    dx = max(-127, min(127, dx))
    dy = max(-127, min(127, dy))
    # Convert to unsigned bytes for negative values
    dx_byte = dx & 0xFF
    dy_byte = dy & 0xFF
    hid_service.mouse_report.send_report([0x00, dx_byte, dy_byte, 0x00])
    GLib.timeout_add(20, lambda: hid_service.mouse_report.send_report([0, 0, 0, 0]) or False)


def click(hid_service):
    """Send left mouse click (button down + up)."""
    hid_service.mouse_report.send_report([0x01, 0x00, 0x00, 0x00])  # button 1 down
    GLib.timeout_add(50, lambda: hid_service.mouse_report.send_report([0, 0, 0, 0]) or False)


# --- Main ---

def find_adapter(bus):
    """Find the first Bluetooth adapter path."""
    remote_om = dbus.Interface(
        bus.get_object(BLUEZ_SERVICE, '/'),
        DBUS_OM_IFACE
    )
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
        print('ERROR: No Bluetooth adapter found with GATT Manager support')
        sys.exit(1)

    print(f'Using adapter: {adapter_path}')

    # Register GATT application
    app = Application(bus)
    hid_service = HIDService(bus, 0)
    app.add_service(hid_service)
    app.add_service(DeviceInfoService(bus, 1))
    app.add_service(BatteryService(bus, 2))

    gatt_manager = dbus.Interface(
        bus.get_object(BLUEZ_SERVICE, adapter_path),
        GATT_MANAGER_IFACE
    )

    adv_manager = dbus.Interface(
        bus.get_object(BLUEZ_SERVICE, adapter_path),
        LE_ADVERTISING_MANAGER_IFACE
    )

    adv = Advertisement(bus)

    mainloop = GLib.MainLoop()

    def register_app_cb():
        print('GATT application registered')

    def register_app_error_cb(error):
        print(f'ERROR registering GATT application: {error}')
        mainloop.quit()

    def register_adv_cb():
        print('Advertisement registered')
        print('Waiting for iPhone to connect...')
        print('On iPhone: Settings > Bluetooth > tap "baremobile"')

    def register_adv_error_cb(error):
        print(f'ERROR registering advertisement: {error}')
        mainloop.quit()

    gatt_manager.RegisterApplication(
        app.get_path(), {},
        reply_handler=register_app_cb,
        error_handler=register_app_error_cb
    )

    adv_manager.RegisterAdvertisement(
        adv.path, {},
        reply_handler=register_adv_cb,
        error_handler=register_adv_error_cb
    )

    # Handle CLI commands
    args = sys.argv[1:]
    if args:
        cmd = args[0]
        if cmd == 'send_key' and len(args) >= 2:
            GLib.timeout_add(2000, lambda: send_key(hid_service, args[1]) or False)
            GLib.timeout_add(3000, lambda: mainloop.quit() or False)
        elif cmd == 'send_string' and len(args) >= 2:
            text = ' '.join(args[1:])
            delay = len(text) * 70 + 2000
            GLib.timeout_add(2000, lambda: send_string(hid_service, text) or False)
            GLib.timeout_add(delay + 1000, lambda: mainloop.quit() or False)
        elif cmd == 'click':
            GLib.timeout_add(2000, lambda: click(hid_service) or False)
            GLib.timeout_add(3000, lambda: mainloop.quit() or False)
        elif cmd == 'move' and len(args) >= 3:
            dx, dy = int(args[1]), int(args[2])
            GLib.timeout_add(2000, lambda: move_mouse(hid_service, dx, dy) or False)
            GLib.timeout_add(3000, lambda: mainloop.quit() or False)
        else:
            print(f'Unknown command: {cmd}')
            print('Usage: send_key <char> | send_string <text> | click | move <dx> <dy>')
            sys.exit(1)
    else:
        print('GATT server running. Press Ctrl+C to stop.')
        print('Commands: send_key, send_string, click, move')

    try:
        mainloop.run()
    except KeyboardInterrupt:
        print('\nStopping...')


if __name__ == '__main__':
    main()
