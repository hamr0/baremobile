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

  it('should have a device serial (UDID)', () => {
    assert.ok(page.serial, 'serial should be set');
    assert.notEqual(page.serial, 'unknown', 'serial should be resolved');
    assert.ok(page.serial.length >= 20, `UDID too short: ${page.serial}`);
  });

  it('should screenshot the current screen', async () => {
    const buf = await page.screenshot();
    assert.ok(Buffer.isBuffer(buf), 'should return a Buffer');
    assert.ok(buf.length > 1024, `too small (${buf.length} bytes)`);
    assert.equal(buf[0], 0x89, 'PNG magic byte');
  });

  it('should snapshot accessibility elements', async () => {
    const snap = await page.snapshot();
    assert.ok(typeof snap === 'string', 'snapshot should be a string');
    assert.ok(snap.length > 0, 'snapshot should not be empty');
    assert.match(snap, /\[ref=0\]/, 'should contain [ref=0]');
    console.log(`    snapshot (first 500 chars):\n${snap.slice(0, 500)}`);
  });

  describe('accessibility-based navigation', () => {
    let settingsPid;

    before(async () => {
      settingsPid = await page.launch('com.apple.Preferences');
      await new Promise(r => setTimeout(r, 2000));
    });

    after(async () => {
      if (settingsPid) await page.kill(settingsPid).catch(() => {});
    });

    it('should snapshot Settings with recognizable elements', async () => {
      const snap = await page.snapshot();
      assert.ok(snap.includes('[ref='), 'should have ref markers');
      // Settings app should have some recognizable labels
      const hasKnownLabel = /Wi-Fi|General|Bluetooth|Display|Notifications/i.test(snap);
      assert.ok(hasKnownLabel, `Settings snapshot should have known labels:\n${snap.slice(0, 800)}`);
      console.log(`    Settings snapshot:\n${snap.slice(0, 600)}`);
    });

    it('should tap(ref) and navigate to a different screen', async () => {
      const before = await page.snapshot();

      // Find a tappable ref (skip ref 0 which may be a header)
      const refMatch = before.match(/\[ref=(\d+)\].*"(Wi-Fi|General|Bluetooth)"/);
      assert.ok(refMatch, `Could not find known row to tap in:\n${before.slice(0, 500)}`);
      const ref = parseInt(refMatch[1], 10);
      const label = refMatch[2];
      console.log(`    tapping ref=${ref} ("${label}")...`);

      await page.tap(ref);
      await new Promise(r => setTimeout(r, 1500));

      const after = await page.snapshot();
      assert.notEqual(before, after, 'snapshot should change after tap');
      console.log(`    after tap:\n${after.slice(0, 400)}`);
    });

    it('should waitForText() resolve when text is on screen', async () => {
      // We're in some sub-screen after the tap above — go back to Settings
      await page.back();
      await new Promise(r => setTimeout(r, 1000));

      const snap = await page.waitForText('Settings', 10_000);
      assert.ok(snap.includes('Settings'), 'should find Settings text');
    });

    it('full loop: launch → snapshot → tap → snapshot → verify change', async () => {
      // Kill and relaunch Settings
      await page.kill(settingsPid).catch(() => {});
      settingsPid = await page.launch('com.apple.Preferences');
      await new Promise(r => setTimeout(r, 2000));

      // Step 1: Snapshot
      const snap1 = await page.snapshot();
      assert.match(snap1, /\[ref=/, 'step1 should have refs');

      // Step 2: Tap a row
      const refMatch = snap1.match(/\[ref=(\d+)\]/);
      assert.ok(refMatch, 'should find a ref to tap');
      const ref = parseInt(refMatch[1], 10);
      console.log(`    full loop: tapping ref=${ref}...`);
      await page.tap(ref);
      await new Promise(r => setTimeout(r, 1500));

      // Step 3: Snapshot again — should differ
      const snap2 = await page.snapshot();
      assert.notEqual(snap1, snap2, 'screen should change after tap');
      console.log('    full loop verified — snapshots differ');
    });
  });
});
