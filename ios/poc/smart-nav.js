#!/usr/bin/env node
// POC: Smart WDA navigation using element APIs
// No /source dumps, no regex, no coordinate guessing

const BASE = 'http://localhost:8100';

async function post(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function get(url) {
  const res = await fetch(url);
  return res.json();
}

// --- WDA helpers ---

async function createSession() {
  const r = await post(`${BASE}/session`, { capabilities: {} });
  return r.sessionId;
}

async function findElement(sid, predicate) {
  const r = await post(`${BASE}/session/${sid}/element`, {
    using: 'predicate string',
    value: predicate
  });
  if (r.value?.error) return null;
  return r.value?.ELEMENT || null;
}

async function findElements(sid, predicate) {
  const r = await post(`${BASE}/session/${sid}/elements`, {
    using: 'predicate string',
    value: predicate
  });
  if (!Array.isArray(r.value)) return [];
  return r.value.map(e => e.ELEMENT);
}

async function clickElement(sid, eid) {
  const r = await post(`${BASE}/session/${sid}/element/${eid}/click`, {});
  return r.value === null; // null = success
}

async function getAttr(sid, eid, name) {
  const r = await get(`${BASE}/session/${sid}/element/${eid}/attribute/${name}`);
  return r.value;
}

async function getElementType(sid, eid) {
  const r = await get(`${BASE}/session/${sid}/element/${eid}/name`);
  return r.value;
}

async function scrollTo(sid, containerEid, name) {
  const r = await post(`${BASE}/session/${sid}/wda/element/${containerEid}/scroll`, { name });
  return r.value === null;
}

async function launchApp(sid, bundleId) {
  await post(`${BASE}/session/${sid}/wda/apps/launch`, { bundleId });
}

async function goHome() {
  await post(`${BASE}/wda/homescreen`);
}

// --- POC ---

async function main() {
  console.log('=== Creating session ===');
  const sid = await createSession();
  console.log(`Session: ${sid}`);

  console.log('\n=== Part 1: Launch Settings (fresh) ===');
  await goHome();
  await new Promise(r => setTimeout(r, 500));
  await launchApp(sid, 'com.apple.Preferences');
  await new Promise(r => setTimeout(r, 1500));
  console.log('Settings launched');

  console.log('\n=== Part 2: Find & tap Accessibility ===');
  // Try direct find first
  let el = await findElement(sid, 'label == "Accessibility" AND type == "XCUIElementTypeStaticText"');
  if (!el) {
    console.log('Not immediately visible, looking for scrollable container...');
    // Find any scrollable view
    const containers = await findElements(sid, 'type == "XCUIElementTypeTable" OR type == "XCUIElementTypeCollectionView" OR type == "XCUIElementTypeScrollView"');
    console.log(`Scrollable containers: ${containers.length}`);
    if (containers.length > 0) {
      console.log('Scrolling to Accessibility...');
      await scrollTo(sid, containers[0], 'Accessibility');
      el = await findElement(sid, 'label == "Accessibility" AND type == "XCUIElementTypeStaticText"');
    }
  }
  if (!el) {
    console.error('FAIL: Could not find Accessibility');
    process.exit(1);
  }
  console.log(`Found element: ${el}`);
  const ok = await clickElement(sid, el);
  console.log(`Clicked: ${ok}`);
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n=== Part 3: Scroll to Keyboards ===');
  const containers2 = await findElements(sid, 'type == "XCUIElementTypeTable" OR type == "XCUIElementTypeCollectionView" OR type == "XCUIElementTypeScrollView"');
  if (containers2.length > 0) {
    console.log('Scrolling to Keyboards...');
    await scrollTo(sid, containers2[0], 'Keyboards');
  }
  await new Promise(r => setTimeout(r, 500));

  console.log('\n=== Part 4: Find & click Keyboards ===');
  // Find the cell (tappable), not the static text label
  el = await findElement(sid, 'label CONTAINS "Keyboard" AND type == "XCUIElementTypeCell"');
  if (!el) {
    el = await findElement(sid, 'name == "KEYBOARDS"');
  }
  if (!el) {
    console.error('FAIL: Could not find Keyboards');
    process.exit(1);
  }
  console.log(`Found: ${el}`);
  await clickElement(sid, el);
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n=== Part 5: Read Full Keyboard Access ===');
  const fka = await findElement(sid, 'label CONTAINS "Full Keyboard Access"');
  if (fka) {
    const type = await getElementType(sid, fka);
    const value = await getAttr(sid, fka, 'value');
    console.log(`Element: ${fka}`);
    console.log(`Type: ${type}`);
    console.log(`Value: ${value} (0=off, 1=on)`);
  } else {
    console.log('FKA element not found on this page');
  }

  console.log('\n=== Part 6: Element type differentiation ===');

  // Find all switches
  const switches = await findElements(sid, 'type == "XCUIElementTypeSwitch" AND visible == true');
  console.log(`Switches (${switches.length}):`);
  for (const sw of switches) {
    const label = await getAttr(sid, sw, 'label');
    const value = await getAttr(sid, sw, 'value');
    if (label) console.log(`  TOGGLE: "${label}" = ${value === '1' ? 'ON' : 'OFF'}`);
  }

  // Find all navigation cells (cells with visible text)
  const cells = await findElements(sid, 'type == "XCUIElementTypeCell" AND visible == true');
  console.log(`\nNavigation cells (${cells.length}):`);
  for (const c of cells) {
    const label = await getAttr(sid, c, 'label');
    if (label && !label.includes('PLACEHOLDER')) {
      // Check if it has a chevron (navigation) or switch (toggle)
      const type = await getElementType(sid, c);
      console.log(`  CELL: "${label}"`);
    }
  }

  console.log('\n=== DONE ===');
  console.log('Full path: Settings > Accessibility > Keyboards');
  console.log('Method: element search + click only. Zero /source dumps.');
}

main().catch(e => { console.error(e); process.exit(1); });
