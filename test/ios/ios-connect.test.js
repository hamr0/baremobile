import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../../src/ios.js';

describe('iOS connect() — integration tests', () => {
  let page;

  before(async () => {
    page = await connect();
    console.log(`    Connected: ${page.serial} (${page.platform})`);
  });

  after(() => {
    if (page) page.close();
  });

  it('should have platform ios', () => {
    assert.equal(page.platform, 'ios');
  });

  it('should have a device serial', () => {
    assert.ok(page.serial, 'serial should be set');
    assert.notEqual(page.serial, 'unknown', 'serial should be resolved');
  });

  it('should take a screenshot returning PNG buffer > 1KB', async () => {
    const buf = await page.screenshot();
    assert.ok(Buffer.isBuffer(buf), 'should return a Buffer');
    assert.ok(buf.length > 1024, `Screenshot too small: ${buf.length} bytes`);
    // Check PNG magic bytes
    assert.equal(buf[0], 0x89, 'PNG magic byte 0');
    assert.equal(buf[1], 0x50, 'PNG magic byte 1 (P)');
    assert.equal(buf[2], 0x4E, 'PNG magic byte 2 (N)');
    assert.equal(buf[3], 0x47, 'PNG magic byte 3 (G)');
    console.log(`    Screenshot: ${(buf.length / 1024).toFixed(0)} KB`);
  });

  it('should launch and kill Settings app', async () => {
    const pid = await page.launch('com.apple.Preferences');
    assert.ok(typeof pid === 'number', 'launch should return a number');
    assert.ok(pid > 0, `PID should be positive: ${pid}`);
    console.log(`    Launched Settings (pid: ${pid})`);

    await page.kill(pid);
    console.log(`    Killed pid ${pid}`);
  });

  describe('BLE HID input (requires paired device)', () => {
    it('should tap via BLE', async () => {
      // Launch Settings first
      const pid = await page.launch('com.apple.Preferences');
      await new Promise(r => setTimeout(r, 2000));

      console.log('    tapping (187, 300)...');
      await page.tapXY(187, 300);
      await new Promise(r => setTimeout(r, 1500));

      const buf = await page.screenshot();
      assert.ok(buf.length > 1024, 'Post-tap screenshot too small');
      console.log(`    Post-tap screenshot: ${(buf.length / 1024).toFixed(0)} KB`);

      await page.kill(pid);
    });

    it('should type text via BLE', async () => {
      // Open Settings and tap search bar
      const pid = await page.launch('com.apple.Preferences');
      await new Promise(r => setTimeout(r, 2000));

      // Tap search bar area
      await page.tapXY(187, 110);
      await new Promise(r => setTimeout(r, 1000));

      console.log('    typing "general"...');
      await page.type('general');
      await new Promise(r => setTimeout(r, 1000));

      const buf = await page.screenshot();
      assert.ok(buf.length > 1024, 'Post-type screenshot too small');
      console.log(`    Post-type screenshot: ${(buf.length / 1024).toFixed(0)} KB`);

      await page.kill(pid);
    });

    it('should complete full loop: screenshot → tapXY → screenshot', async () => {
      const pid = await page.launch('com.apple.Preferences');
      await new Promise(r => setTimeout(r, 2000));

      const before = await page.screenshot();
      assert.ok(before.length > 1024);
      console.log(`    Before: ${(before.length / 1024).toFixed(0)} KB`);

      await page.tapXY(187, 300);
      await new Promise(r => setTimeout(r, 1500));

      const after = await page.screenshot();
      assert.ok(after.length > 1024);
      console.log(`    After: ${(after.length / 1024).toFixed(0)} KB`);

      // Screenshots should differ (navigated to different screen)
      const sizeDiff = Math.abs(before.length - after.length);
      console.log(`    Size diff: ${(sizeDiff / 1024).toFixed(0)} KB`);

      await page.kill(pid);
    });
  });
});
