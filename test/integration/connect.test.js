// Integration tests — requires ADB-connected device/emulator
// Skip gracefully if no device available

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../../src/index.js';
import { listDevices } from '../../src/adb.js';

// Detect device at module load (top-level await)
let hasDevice = false;
try {
  const devices = await listDevices();
  hasDevice = devices.length > 0;
} catch {
  hasDevice = false;
}

describe('connect', { skip: !hasDevice && 'No ADB device available' }, () => {
  let page;

  before(async () => {
    page = await connect();
  });

  after(() => {
    if (page) page.close();
  });

  it('returns page object with all methods', () => {
    assert.ok(page);
    assert.strictEqual(typeof page.snapshot, 'function');
    assert.strictEqual(typeof page.tap, 'function');
    assert.strictEqual(typeof page.tapXY, 'function');
    assert.strictEqual(typeof page.tapGrid, 'function');
    assert.strictEqual(typeof page.grid, 'function');
    assert.strictEqual(typeof page.type, 'function');
    assert.strictEqual(typeof page.press, 'function');
    assert.strictEqual(typeof page.swipe, 'function');
    assert.strictEqual(typeof page.scroll, 'function');
    assert.strictEqual(typeof page.longPress, 'function');
    assert.strictEqual(typeof page.back, 'function');
    assert.strictEqual(typeof page.home, 'function');
    assert.strictEqual(typeof page.launch, 'function');
    assert.strictEqual(typeof page.intent, 'function');
    assert.strictEqual(typeof page.waitForText, 'function');
    assert.strictEqual(typeof page.waitForState, 'function');
    assert.strictEqual(typeof page.screenshot, 'function');
    assert.strictEqual(typeof page.close, 'function');
    assert.strictEqual(typeof page.serial, 'string');
  });

  it('snapshot() returns YAML string with refs', async () => {
    const yaml = await page.snapshot();
    assert.ok(yaml.length > 0);
    assert.ok(yaml.includes('- '), 'Should have YAML-like format');
    assert.ok(yaml.includes('[ref='), 'Should have ref markers');
  });

  it('launch() opens Settings app', async () => {
    await page.launch('com.android.settings');
    await new Promise(r => setTimeout(r, 2000));
    const yaml = await page.snapshot();
    assert.ok(yaml.includes('Settings') || yaml.includes('settings'),
      'Settings app should be visible in snapshot:\n' + yaml.slice(0, 300));
  });

  it('press("back") navigates back', async () => {
    await page.press('back');
    await new Promise(r => setTimeout(r, 500));
    assert.ok(true);
  });

  it('screenshot() returns PNG buffer', async () => {
    const buf = await page.screenshot();
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 1000, 'PNG should be > 1KB');
    // PNG magic bytes
    assert.strictEqual(buf[0], 0x89);
    assert.strictEqual(buf[1], 0x50); // P
    assert.strictEqual(buf[2], 0x4E); // N
    assert.strictEqual(buf[3], 0x47); // G
  });

  it('grid() returns grid with resolve function', async () => {
    const g = await page.grid();
    assert.ok(g.cols === 10);
    assert.ok(g.rows > 0);
    assert.ok(g.cellW > 0);
    assert.ok(g.cellH > 0);
    assert.ok(g.text.includes('Screen:'));
    const center = g.resolve('A1');
    assert.ok(center.x > 0 && center.y > 0);
  });

  it('tapXY() taps by coordinates', async () => {
    await page.home();
    await new Promise(r => setTimeout(r, 500));
    await page.tapXY(540, 1200);
    await new Promise(r => setTimeout(r, 300));
    assert.ok(true);
  });

  it('tapGrid() taps by grid cell', async () => {
    await page.home();
    await new Promise(r => setTimeout(r, 500));
    await page.tapGrid('E10');
    await new Promise(r => setTimeout(r, 300));
    assert.ok(true);
  });

  it('intent() navigates directly to settings subsection', async () => {
    await page.intent('android.settings.BLUETOOTH_SETTINGS');
    await new Promise(r => setTimeout(r, 1500));
    const snap = await page.snapshot();
    assert.ok(snap.includes('Bluetooth') || snap.includes('Connected devices'),
      'Should show Bluetooth or Connected devices screen');
  });

  it('waitForText() resolves when text is present', async () => {
    const snap = await page.waitForText('Bluetooth', 5000);
    assert.ok(snap.includes('Bluetooth'));
  });

  it('waitForText() throws on timeout', async () => {
    await assert.rejects(
      () => page.waitForText('XYZNONEXISTENT', 1500),
      { message: /not found after/ },
    );
  });

  it('home() goes to home screen', async () => {
    await page.home();
    await new Promise(r => setTimeout(r, 500));
    const yaml = await page.snapshot();
    assert.ok(yaml.length > 0);
  });
});
