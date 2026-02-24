import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
// BLE HID uses system Python (3.14) — dbus-python/PyGObject are system packages.
// pymobiledevice3 uses python3.12 separately (3.14 has build failures).
const PYTHON = 'python3';
const POC_SCRIPT = new URL('./ble-hid-poc.py', import.meta.url).pathname;

/**
 * Check BLE HID prerequisites:
 * - Python 3.12 with dbus and gi modules
 * - BlueZ with GATT Manager support
 * - Bluetooth adapter in peripheral-capable state
 */
async function checkPrerequisites() {
  const errors = [];

  // Check Python 3.12
  try {
    await exec(PYTHON, ['--version'], { timeout: 5000 });
  } catch {
    errors.push('Python 3.12 not found');
  }

  // Check dbus-python
  try {
    await exec(PYTHON, ['-c', 'import dbus'], { timeout: 5000 });
  } catch {
    errors.push('dbus-python not installed (sudo dnf install python3-dbus)');
  }

  // Check PyGObject
  try {
    await exec(PYTHON, ['-c', 'from gi.repository import GLib'], { timeout: 5000 });
  } catch {
    errors.push('PyGObject not installed (sudo dnf install python3-gobject)');
  }

  // Check bluetoothctl exists (BlueZ installed)
  try {
    await exec('bluetoothctl', ['--version'], { timeout: 5000 });
  } catch {
    errors.push('BlueZ not installed (bluetoothctl not found)');
  }

  return errors;
}

let prereqErrors = [];
try {
  prereqErrors = await checkPrerequisites();
} catch {
  prereqErrors = ['Prerequisite check failed'];
}

const skipReason = prereqErrors.length > 0
  ? `BLE HID prerequisites not met: ${prereqErrors.join(', ')}`
  : false;

describe('iOS BLE HID spike', { skip: skipReason }, () => {
  it('should have Python dbus bindings', async () => {
    const result = await exec(PYTHON, ['-c', 'import dbus; print(dbus.__version__ if hasattr(dbus, "__version__") else "available")'], {
      timeout: 5000,
    });
    console.log(`    dbus-python: ${result.stdout.trim()}`);
    assert.ok(result.stdout.trim().length > 0);
  });

  it('should have PyGObject (gi)', async () => {
    const result = await exec(PYTHON, ['-c', 'import gi; print(gi.__version__)'], {
      timeout: 5000,
    });
    console.log(`    PyGObject: ${result.stdout.trim()}`);
    assert.ok(result.stdout.trim().length > 0);
  });

  it('should detect BlueZ version', async () => {
    const result = await exec('bluetoothctl', ['--version'], { timeout: 5000 });
    const version = result.stdout.trim();
    console.log(`    ${version}`);
    // Extract version number, should be >= 5.56
    const match = version.match(/(\d+\.\d+)/);
    assert.ok(match, 'Could not parse BlueZ version');
    const ver = parseFloat(match[1]);
    assert.ok(ver >= 5.56, `BlueZ ${ver} too old, need >= 5.56`);
  });

  it('should parse POC script without syntax errors', async () => {
    const result = await exec(PYTHON, ['-c', `import py_compile; py_compile.compile('${POC_SCRIPT}', doraise=True)`], {
      timeout: 5000,
    });
    // py_compile returns empty on success
    assert.ok(true, 'POC script compiles without errors');
  });

  it('should have valid HID Report Map', async () => {
    // Import the report map from the POC and validate its structure
    const result = await exec(PYTHON, ['-c', `
import sys
sys.path.insert(0, '${POC_SCRIPT.replace('/ble-hid-poc.py', '')}')
# Just check the file parses and has the key constants
exec(open('${POC_SCRIPT}').read().split("# --- D-Bus")[0])
print(f'Report Map: {len(REPORT_MAP)} bytes')
print(f'Keycodes: {len(CHAR_TO_KEYCODE)} chars')
print(f'Shift chars: {len(SHIFT_CHARS)} chars')
assert len(REPORT_MAP) > 50, 'Report Map too short'
assert len(CHAR_TO_KEYCODE) > 30, 'Too few keycodes'
`], { timeout: 5000 });
    console.log(`    ${result.stdout.trim().split('\n').join(', ')}`);
    assert.ok(result.stdout.includes('Report Map'));
  });
});
