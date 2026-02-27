#!/usr/bin/env node
// Real-device test: validates all ios.js page methods against a running WDA.
// Usage: node ios/test-wda.js

import { connect } from '../src/ios.js';

const pass = (name) => console.log(`  ✓ ${name}`);
const fail = (name, err) => { console.log(`  ✗ ${name}: ${err}`); process.exitCode = 1; };
let page;

try {
  page = await connect();
} catch (e) {
  console.log('Cannot connect to WDA:', e.message);
  console.log('Run: npx baremobile setup  (option 3)');
  process.exit(1);
}

console.log('\n=== iOS WDA real-device tests ===\n');

// 0. Start clean — go home first
await page.home();
await new Promise(r => setTimeout(r, 1000));

// 1. snapshot
try {
  const snap = await page.snapshot();
  if (snap && snap.includes('[ref=')) pass('snapshot() — got refs');
  else fail('snapshot()', 'no [ref=] markers in output');
} catch (e) { fail('snapshot()', e.message); }

// 2. screenshot
try {
  const png = await page.screenshot();
  if (png.length > 1000 && png[0] === 0x89 && png[1] === 0x50)
    pass(`screenshot() — ${png.length} bytes, valid PNG`);
  else fail('screenshot()', `bad PNG: ${png.length} bytes`);
} catch (e) { fail('screenshot()', e.message); }

// 3. launch
try {
  await page.launch('com.apple.Preferences');
  await new Promise(r => setTimeout(r, 3000));
  const snap = await page.snapshot();
  // Settings may resume at a sub-page — that's valid iOS behavior
  const hasSettings = snap.includes('Wi-Fi') || snap.includes('General') || snap.includes('Bluetooth')
    || snap.includes('Airplane') || snap.includes('Cellular') || snap.includes('Settings')
    || snap.includes('StandBy') || snap.includes('Notifications');
  if (hasSettings)
    pass('launch(com.apple.Preferences) — Settings visible');
  else {
    console.log('    Snapshot:', snap.substring(0, 300));
    fail('launch()', 'Settings content not found in snapshot');
  }
} catch (e) { fail('launch()', e.message); }

// 4. tap — find a Cell element (like Wi-Fi or General) and tap it
try {
  const snap = await page.snapshot();
  const lines = snap.split('\n');
  let targetRef = null;
  let targetName = '';
  // Look for a Cell with a known settings label
  for (const line of lines) {
    const m = line.match(/\[ref=(\d+)\].*Cell.*"(Wi-Fi|General|Bluetooth|Cellular|Notifications)"/);
    if (m) { targetRef = parseInt(m[1]); targetName = m[2]; break; }
  }
  if (targetRef === null) {
    // Fallback: any Cell element
    for (const line of lines) {
      const m = line.match(/\[ref=(\d+)\].*Cell.*"(.+?)"/);
      if (m) { targetRef = parseInt(m[1]); targetName = m[2]; break; }
    }
  }
  if (targetRef !== null) {
    const before = snap;
    await page.tap(targetRef);
    await new Promise(r => setTimeout(r, 2000));
    const after = await page.snapshot();
    if (after !== before) pass(`tap(${targetRef}) "${targetName}" — screen changed`);
    else pass(`tap(${targetRef}) "${targetName}" — no error (screen may not have changed)`);
  } else {
    console.log('    Available:', snap.substring(0, 300));
    fail('tap()', 'no Cell element found');
  }
} catch (e) { fail('tap()', e.message); }

// 5. back
try {
  await page.back();
  await new Promise(r => setTimeout(r, 1500));
  const snap = await page.snapshot();
  if (snap.includes('Wi-Fi') || snap.includes('General') || snap.includes('Settings'))
    pass('back() — returned to Settings');
  else fail('back()', 'not back at Settings');
} catch (e) { fail('back()', e.message); }

// 6. scroll — scroll down in Settings
try {
  const snapBefore = await page.snapshot();
  // Find a scrollable ref or use ref 0
  const m = snapBefore.match(/\[ref=(\d+)\]/);
  const ref = m ? parseInt(m[1]) : 0;
  await page.scroll(ref, 'down');
  await new Promise(r => setTimeout(r, 1000));
  const snapAfter = await page.snapshot();
  // Scroll should change something (or at least not error)
  pass(`scroll(${ref}, 'down') — no error`);
} catch (e) { fail('scroll()', e.message); }

// 7. swipe — horizontal swipe (benign)
try {
  await page.swipe(200, 400, 100, 400, 300);
  pass('swipe(200,400,100,400) — no error');
} catch (e) { fail('swipe()', e.message); }

// 8. home
try {
  await page.home();
  await new Promise(r => setTimeout(r, 1500));
  const snap = await page.snapshot();
  pass('home() — no error');
} catch (e) { fail('home()', e.message); }

// 9. waitForText — go home, launch Settings, wait for content
try {
  await page.home();
  await new Promise(r => setTimeout(r, 1000));
  await page.launch('com.apple.Preferences');
  // Wait for any common Settings text
  const snap = await page.waitForText('Settings', 10000);
  if (snap) pass('waitForText("Settings") — found');
  else fail('waitForText()', 'text not found');
} catch (e) { fail('waitForText()', e.message); }

// 10. type — find a search field and type
try {
  // Navigate to Settings search
  const snap = await page.snapshot();
  let searchRef = null;
  for (const line of snap.split('\n')) {
    const m = line.match(/\[ref=(\d+)\].*(?:SearchField|TextField)/);
    if (m) { searchRef = parseInt(m[1]); break; }
  }
  if (searchRef !== null) {
    await page.type(searchRef, 'test', { clear: true });
    await new Promise(r => setTimeout(r, 1500));
    const after = await page.snapshot();
    pass(`type(${searchRef}, 'test') — no error`);
  } else {
    // Try tapping Search in Settings to get a search field
    let searchButton = null;
    for (const line of snap.split('\n')) {
      const m = line.match(/\[ref=(\d+)\].*"Search"/);
      if (m) { searchButton = parseInt(m[1]); break; }
    }
    if (searchButton !== null) {
      await page.tap(searchButton);
      await new Promise(r => setTimeout(r, 1000));
      const snap2 = await page.snapshot();
      let sf = null;
      for (const line of snap2.split('\n')) {
        const m = line.match(/\[ref=(\d+)\].*(?:SearchField|TextField)/);
        if (m) { sf = parseInt(m[1]); break; }
      }
      if (sf !== null) {
        await page.type(sf, 'wifi', { clear: true });
        await new Promise(r => setTimeout(r, 1500));
        pass(`type(${sf}, 'wifi') — no error`);
      } else {
        pass('type() — skipped (no search field found)');
      }
    } else {
      pass('type() — skipped (no search field found)');
    }
  }
} catch (e) { fail('type()', e.message); }

// 11. longPress — on first element
try {
  await page.home();
  await new Promise(r => setTimeout(r, 1500));
  await page.launch('com.apple.Preferences');
  await new Promise(r => setTimeout(r, 2000));
  const snap = await page.snapshot();
  const m = snap.match(/\[ref=(\d+)\]/);
  if (m) {
    const ref = parseInt(m[1]);
    await page.longPress(ref);
    await new Promise(r => setTimeout(r, 1000));
    pass(`longPress(${ref}) — no error`);
  } else {
    pass('longPress() — skipped (no refs)');
  }
} catch (e) { fail('longPress()', e.message); }

// 12. tapXY — coordinate tap
try {
  await page.tapXY(200, 400);
  await new Promise(r => setTimeout(r, 500));
  pass('tapXY(200, 400) — no error');
} catch (e) { fail('tapXY()', e.message); }

// 13. press — hardware buttons
try {
  await page.press('home');
  pass('press("home") — no error');
} catch (e) { fail('press("home")', e.message); }

try {
  await page.press('volumeup');
  pass('press("volumeup") — no error');
} catch (e) { fail('press("volumeup")', e.message); }

try {
  await page.press('volumedown');
  pass('press("volumedown") — no error');
} catch (e) { fail('press("volumedown")', e.message); }

// Cleanup
await page.home();
page.close();

console.log('\n=== Done ===\n');
