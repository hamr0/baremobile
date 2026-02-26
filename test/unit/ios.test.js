import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateWda, connect } from '../../src/ios.js';
import { prune } from '../../src/prune.js';
import { formatTree, shortClass } from '../../src/aria.js';

// Sample WDA /source XML fragments for testing
const SIMPLE_BUTTON = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeButton type="XCUIElementTypeButton" visible="true" enabled="true" label="Settings" x="10" y="100" width="100" height="44"/>
</XCUIElementTypeApplication>`;

const SETTINGS_PAGE = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeWindow type="XCUIElementTypeWindow" visible="true" enabled="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" visible="true" enabled="true" label="Settings" x="0" y="0" width="390" height="44">
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="Settings" x="150" y="10" width="90" height="24"/>
    </XCUIElementTypeNavigationBar>
    <XCUIElementTypeTable type="XCUIElementTypeTable" visible="true" enabled="true" x="0" y="44" width="390" height="800">
      <XCUIElementTypeCell type="XCUIElementTypeCell" visible="true" enabled="true" label="Wi-Fi" x="0" y="44" width="390" height="50">
        <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="Wi-Fi" x="20" y="55" width="100" height="20"/>
      </XCUIElementTypeCell>
      <XCUIElementTypeCell type="XCUIElementTypeCell" visible="true" enabled="true" label="Bluetooth" x="0" y="94" width="390" height="50">
        <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="Bluetooth" x="20" y="105" width="100" height="20"/>
      </XCUIElementTypeCell>
      <XCUIElementTypeSwitch type="XCUIElementTypeSwitch" visible="true" enabled="true" label="Airplane Mode" value="0" x="300" y="144" width="50" height="30"/>
    </XCUIElementTypeTable>
  </XCUIElementTypeWindow>
</XCUIElementTypeApplication>`;

const INVISIBLE_LEAF = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeButton type="XCUIElementTypeButton" visible="false" enabled="true" label="Hidden" x="10" y="10" width="100" height="44"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" visible="true" enabled="true" label="Visible" x="10" y="60" width="100" height="44"/>
</XCUIElementTypeApplication>`;

const INVISIBLE_CONTAINER = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeCollectionView type="XCUIElementTypeCollectionView" visible="false" enabled="true" x="0" y="0" width="390" height="800">
    <XCUIElementTypeCell type="XCUIElementTypeCell" visible="true" enabled="true" label="Wi-Fi" x="0" y="44" width="390" height="50"/>
    <XCUIElementTypeCell type="XCUIElementTypeCell" visible="true" enabled="true" label="Bluetooth" x="0" y="94" width="390" height="50"/>
  </XCUIElementTypeCollectionView>
</XCUIElementTypeApplication>`;

const SEARCH_FIELD = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeSearchField type="XCUIElementTypeSearchField" visible="true" enabled="true" label="Search" x="20" y="60" width="350" height="36"/>
</XCUIElementTypeApplication>`;

const NAME_FALLBACK = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeButton type="XCUIElementTypeButton" visible="true" enabled="true" name="backButton" x="10" y="10" width="44" height="44"/>
</XCUIElementTypeApplication>`;

const SELF_CLOSING = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="Hello" x="10" y="10" width="100" height="20"/>
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="World" x="10" y="40" width="100" height="20"/>
</XCUIElementTypeApplication>`;

const ENTITIES_XML = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="Tom &amp; Jerry" x="10" y="10" width="100" height="20"/>
</XCUIElementTypeApplication>`;

const SCROLL_VIEW = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" visible="true" enabled="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeButton type="XCUIElementTypeButton" visible="true" enabled="true" label="Action" x="10" y="100" width="100" height="44"/>
  </XCUIElementTypeScrollView>
</XCUIElementTypeApplication>`;

const DISABLED_BUTTON = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeButton type="XCUIElementTypeButton" visible="true" enabled="false" label="Grayed Out" x="10" y="10" width="100" height="44"/>
</XCUIElementTypeApplication>`;

describe('iOS module — unit tests', () => {

  describe('exports', () => {
    it('should export connect and translateWda', async () => {
      const ios = await import('../../src/ios.js');
      assert.equal(typeof ios.connect, 'function');
      assert.equal(typeof ios.translateWda, 'function');
    });

    it('should export connect and translateWda only', async () => {
      const ios = await import('../../src/ios.js');
      const exports = Object.keys(ios).sort();
      assert.deepEqual(exports, ['connect', 'translateWda']);
    });
  });

  describe('translateWda() — node shape', () => {
    it('should return null for empty input', () => {
      assert.equal(translateWda(null), null);
      assert.equal(translateWda(''), null);
      assert.equal(translateWda(undefined), null);
    });

    it('should parse a simple button with correct fields', () => {
      const root = translateWda(SIMPLE_BUTTON);
      assert.ok(root);
      assert.equal(root.class, 'XCUIElementTypeApplication');
      assert.equal(root.children.length, 1);

      const btn = root.children[0];
      assert.equal(btn.class, 'XCUIElementTypeButton');
      assert.equal(btn.text, 'Settings');
      assert.equal(btn.clickable, true);
      assert.equal(btn.enabled, true);
      assert.deepEqual(btn.bounds, { x1: 10, y1: 100, x2: 110, y2: 144 });
    });

    it('should compute bounds from x, y, width, height', () => {
      const root = translateWda(SIMPLE_BUTTON);
      const btn = root.children[0];
      // x=10, y=100, w=100, h=44 → x2=110, y2=144
      assert.deepEqual(btn.bounds, { x1: 10, y1: 100, x2: 110, y2: 144 });
    });

    it('should preserve hierarchy (nested children)', () => {
      const root = translateWda(SETTINGS_PAGE);
      assert.ok(root);
      // Application > Window > [NavBar, Table]
      const window = root.children[0];
      assert.equal(window.class, 'XCUIElementTypeWindow');
      assert.equal(window.children.length, 2); // NavBar + Table

      const table = window.children[1];
      assert.equal(table.class, 'XCUIElementTypeTable');
      assert.equal(table.scrollable, true);
      assert.equal(table.children.length, 3); // 2 cells + 1 switch
    });

    it('should skip invisible leaf nodes', () => {
      const root = translateWda(INVISIBLE_LEAF);
      assert.ok(root);
      assert.equal(root.children.length, 1);
      assert.equal(root.children[0].text, 'Visible');
    });

    it('should keep invisible containers but process visible children', () => {
      const root = translateWda(INVISIBLE_CONTAINER);
      assert.ok(root);
      // Application > CollectionView (invisible, kept as wrapper) > 2 cells
      const cv = root.children[0];
      assert.equal(cv.class, 'XCUIElementTypeCollectionView');
      assert.equal(cv.text, ''); // invisible — text stripped
      assert.equal(cv.scrollable, false); // invisible — flags stripped
      assert.equal(cv.bounds, null); // invisible — bounds stripped
      assert.equal(cv.children.length, 2);
      assert.equal(cv.children[0].text, 'Wi-Fi');
      assert.equal(cv.children[1].text, 'Bluetooth');
      assert.equal(cv.children[0].clickable, true); // Cell is clickable
    });

    it('should map switch value to checked boolean', () => {
      const root = translateWda(SETTINGS_PAGE);
      const table = root.children[0].children[1]; // Window > Table
      const sw = table.children[2]; // Switch
      assert.equal(sw.class, 'XCUIElementTypeSwitch');
      assert.equal(sw.checked, false); // value="0"
      assert.equal(sw.clickable, true);
      assert.equal(sw.text, 'Airplane Mode');
    });

    it('should set editable for text fields', () => {
      const root = translateWda(SEARCH_FIELD);
      const field = root.children[0];
      assert.equal(field.class, 'XCUIElementTypeSearchField');
      assert.equal(field.editable, true);
      assert.equal(field.clickable, false);
    });

    it('should set scrollable for scroll containers', () => {
      const root = translateWda(SCROLL_VIEW);
      const sv = root.children[0];
      assert.equal(sv.class, 'XCUIElementTypeScrollView');
      assert.equal(sv.scrollable, true);
    });

    it('should use name as contentDesc when label is empty', () => {
      const root = translateWda(NAME_FALLBACK);
      const btn = root.children[0];
      assert.equal(btn.text, '');
      assert.equal(btn.contentDesc, 'backButton');
    });

    it('should handle self-closing tags', () => {
      const root = translateWda(SELF_CLOSING);
      assert.equal(root.children.length, 2);
      assert.equal(root.children[0].text, 'Hello');
      assert.equal(root.children[1].text, 'World');
    });

    it('should decode XML entities in labels', () => {
      const root = translateWda(ENTITIES_XML);
      assert.equal(root.children[0].text, 'Tom & Jerry');
    });

    it('should set enabled=false for disabled nodes', () => {
      const root = translateWda(DISABLED_BUTTON);
      const btn = root.children[0];
      assert.equal(btn.enabled, false);
    });
  });

  describe('translateWda() → prune() → formatTree() pipeline', () => {
    it('should produce hierarchical YAML with refs for interactive elements', () => {
      const root = translateWda(SETTINGS_PAGE);
      const { tree, refMap } = prune(root);
      assert.ok(tree);
      assert.ok(refMap.size > 0);

      const yaml = formatTree(tree);
      assert.ok(yaml.includes('[ref='));
      assert.ok(yaml.includes('Settings'));
      assert.ok(yaml.includes('Wi-Fi'));
      assert.ok(yaml.includes('Bluetooth'));
    });

    it('should assign refs to clickable, editable, and scrollable nodes', () => {
      const root = translateWda(SETTINGS_PAGE);
      const { refMap } = prune(root);

      // Table (scrollable), 2 cells (clickable), 1 switch (clickable) = 4 refs
      assert.ok(refMap.size >= 4);

      // All ref nodes should have bounds
      for (const [, node] of refMap) {
        assert.ok(node.bounds, `Node ${node.class} missing bounds`);
      }
    });

    it('should produce YAML matching Android format', () => {
      const root = translateWda(SIMPLE_BUTTON);
      const { tree } = prune(root);
      const yaml = formatTree(tree);

      // Should have indentation (hierarchy) and role names
      assert.match(yaml, /Button/);
      assert.match(yaml, /\[ref=\d+\]/);
      assert.match(yaml, /"Settings"/);
    });

    it('should show checked state for switches', () => {
      const switchOn = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeSwitch type="XCUIElementTypeSwitch" visible="true" enabled="true" label="Wi-Fi" value="1" x="300" y="100" width="50" height="30"/>
</XCUIElementTypeApplication>`;
      const root = translateWda(switchOn);
      const { tree } = prune(root);
      const yaml = formatTree(tree);
      assert.ok(yaml.includes('[checked]'));
    });

    it('should show disabled state', () => {
      const root = translateWda(DISABLED_BUTTON);
      const { tree } = prune(root);
      const yaml = formatTree(tree);
      assert.ok(yaml.includes('[disabled]'));
    });
  });

  describe('iOS CLASS_MAP integration', () => {
    it('should map XCUIElementType* to short roles via shortClass', () => {
      assert.equal(shortClass('XCUIElementTypeButton'), 'Button');
      assert.equal(shortClass('XCUIElementTypeStaticText'), 'Text');
      assert.equal(shortClass('XCUIElementTypeCell'), 'Cell');
      assert.equal(shortClass('XCUIElementTypeSwitch'), 'Switch');
      assert.equal(shortClass('XCUIElementTypeTextField'), 'TextInput');
      assert.equal(shortClass('XCUIElementTypeTable'), 'List');
      assert.equal(shortClass('XCUIElementTypeScrollView'), 'ScrollView');
      assert.equal(shortClass('XCUIElementTypeNavigationBar'), 'NavBar');
      assert.equal(shortClass('XCUIElementTypeOther'), 'Group');
      assert.equal(shortClass('XCUIElementTypeApplication'), 'App');
    });

    it('should map additional iOS types (PickerWheel, TabBar, etc.)', () => {
      assert.equal(shortClass('XCUIElementTypePickerWheel'), 'Picker');
      assert.equal(shortClass('XCUIElementTypePageIndicator'), 'PageIndicator');
      assert.equal(shortClass('XCUIElementTypeToolbar'), 'Toolbar');
      assert.equal(shortClass('XCUIElementTypeTabBar'), 'TabBar');
      assert.equal(shortClass('XCUIElementTypeSheet'), 'Sheet');
    });
  });

  describe('coordinate calculation from bounds', () => {
    it('should compute center from node bounds', () => {
      const root = translateWda(SIMPLE_BUTTON);
      const btn = root.children[0];
      // bounds: x1=10, y1=100, x2=110, y2=144
      const cx = Math.round((btn.bounds.x1 + btn.bounds.x2) / 2);
      const cy = Math.round((btn.bounds.y1 + btn.bounds.y2) / 2);
      assert.equal(cx, 60);
      assert.equal(cy, 122);
    });

    it('should compute center for all ref nodes', () => {
      const root = translateWda(SETTINGS_PAGE);
      const { refMap } = prune(root);

      for (const [, node] of refMap) {
        const b = node.bounds;
        assert.ok(b);
        const cx = Math.round((b.x1 + b.x2) / 2);
        const cy = Math.round((b.y1 + b.y2) / 2);
        assert.ok(cx >= b.x1 && cx <= b.x2, `center x ${cx} outside bounds`);
        assert.ok(cy >= b.y1 && cy <= b.y2, `center y ${cy} outside bounds`);
      }
    });
  });

  describe('StatusBar filtering', () => {
    const STATUSBAR_XML = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeStatusBar type="XCUIElementTypeStatusBar" visible="true" enabled="true" x="0" y="0" width="390" height="54">
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="9:41" x="10" y="10" width="50" height="20"/>
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="100%" x="340" y="10" width="40" height="20"/>
  </XCUIElementTypeStatusBar>
  <XCUIElementTypeButton type="XCUIElementTypeButton" visible="true" enabled="true" label="Action" x="10" y="100" width="100" height="44"/>
</XCUIElementTypeApplication>`;

    it('should strip StatusBar and all its children', () => {
      const root = translateWda(STATUSBAR_XML);
      assert.ok(root);
      // Only the button should remain — no StatusBar, no 9:41, no 100%
      assert.equal(root.children.length, 1);
      assert.equal(root.children[0].class, 'XCUIElementTypeButton');
      assert.equal(root.children[0].text, 'Action');
    });

    it('should not contain time or battery text after pruning', () => {
      const root = translateWda(STATUSBAR_XML);
      const { tree } = prune(root);
      const yaml = formatTree(tree);
      assert.ok(!yaml.includes('9:41'));
      assert.ok(!yaml.includes('100%'));
      assert.ok(yaml.includes('Action'));
    });
  });

  describe('dedup — same-text siblings', () => {
    const DEDUP_XML = `
<XCUIElementTypeApplication type="XCUIElementTypeApplication" visible="true" enabled="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeOther type="XCUIElementTypeOther" visible="true" enabled="true" x="0" y="0" width="390" height="100">
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="Wi-Fi" x="20" y="55" width="100" height="20"/>
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="Wi-Fi" x="120" y="55" width="100" height="20"/>
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" visible="true" enabled="true" label="Connected" x="250" y="55" width="100" height="20"/>
  </XCUIElementTypeOther>
</XCUIElementTypeApplication>`;

    it('should dedup same-class same-text siblings', () => {
      const root = translateWda(DEDUP_XML);
      const { tree } = prune(root);
      const yaml = formatTree(tree);
      // Two identical StaticText "Wi-Fi" siblings → deduped to one
      const count = (yaml.match(/Wi-Fi/g) || []).length;
      assert.equal(count, 1, `Expected "Wi-Fi" once, got ${count}: ${yaml}`);
    });
  });

  describe('press() key coverage', () => {
    // We can't call press() without a WDA connection, but we can verify
    // the action map covers the expected keys by inspecting the source
    it('should support home, enter, volumeup, volumedown, volume_up, volume_down', async () => {
      const src = (await import('node:fs')).readFileSync('src/ios.js', 'utf8');
      for (const key of ['home', 'enter', 'volumeup', 'volumedown', 'volume_up', 'volume_down']) {
        assert.ok(src.includes(`${key}:`), `press() missing key: ${key}`);
      }
    });
  });

  describe('page object API completeness', () => {
    // Verify all expected methods exist by reading the source for method definitions
    it('should define all required page methods', async () => {
      const src = (await import('node:fs')).readFileSync('src/ios.js', 'utf8');
      const methods = [
        'snapshot', 'tap', 'type', 'press', 'swipe', 'scroll',
        'longPress', 'tapXY', 'back', 'home', 'lock', 'unlock',
        'launch', 'activate', 'screenshot', 'waitForText', 'waitForState', 'close',
      ];
      for (const m of methods) {
        assert.ok(src.includes(`async ${m}(`) || src.includes(`${m}(`),
          `Missing page method: ${m}`);
      }
    });
  });
});
