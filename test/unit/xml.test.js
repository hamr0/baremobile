import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, parseBounds } from '../../src/xml.js';

describe('parseBounds', () => {
  it('parses standard bounds format', () => {
    const b = parseBounds('[0,0][1080,1920]');
    assert.deepStrictEqual(b, { x1: 0, y1: 0, x2: 1080, y2: 1920 });
  });

  it('returns null for empty string', () => {
    assert.strictEqual(parseBounds(''), null);
  });

  it('returns null for malformed input', () => {
    assert.strictEqual(parseBounds('not-bounds'), null);
  });
});

describe('parseXml', () => {
  it('parses a single node', () => {
    const xml = '<?xml version="1.0"?><hierarchy><node class="android.widget.TextView" text="Hello" content-desc="greeting" resource-id="com.app:id/tv" bounds="[10,20][100,50]" clickable="true" scrollable="false" enabled="true" checked="false" selected="false" focused="false" /></hierarchy>';
    const root = parseXml(xml);
    assert.ok(root);
    assert.strictEqual(root.class, 'android.widget.TextView');
    assert.strictEqual(root.text, 'Hello');
    assert.strictEqual(root.contentDesc, 'greeting');
    assert.strictEqual(root.resourceId, 'com.app:id/tv');
    assert.deepStrictEqual(root.bounds, { x1: 10, y1: 20, x2: 100, y2: 50 });
    assert.strictEqual(root.clickable, true);
    assert.strictEqual(root.scrollable, false);
    assert.strictEqual(root.editable, false);
    assert.strictEqual(root.enabled, true);
    assert.strictEqual(root.checked, false);
    assert.strictEqual(root.selected, false);
    assert.strictEqual(root.focused, false);
  });

  it('parses nested tree with parent-child relationships', () => {
    const xml = `<?xml version="1.0"?>
<hierarchy>
<node class="android.widget.FrameLayout" text="" bounds="[0,0][1080,1920]" clickable="false" scrollable="false" enabled="true" checked="false" selected="false" focused="false">
  <node class="android.widget.TextView" text="Child" bounds="[10,10][200,50]" clickable="false" scrollable="false" enabled="true" checked="false" selected="false" focused="false" />
</node>
</hierarchy>`;
    const root = parseXml(xml);
    assert.ok(root);
    assert.strictEqual(root.class, 'android.widget.FrameLayout');
    assert.strictEqual(root.children.length, 1);
    assert.strictEqual(root.children[0].text, 'Child');
  });

  it('handles self-closing nodes', () => {
    const xml = '<?xml version="1.0"?><hierarchy><node class="android.widget.Button" text="OK" bounds="[0,0][100,50]" clickable="true" scrollable="false" enabled="true" checked="false" selected="false" focused="false" /></hierarchy>';
    const root = parseXml(xml);
    assert.ok(root);
    assert.strictEqual(root.text, 'OK');
    assert.strictEqual(root.children.length, 0);
  });

  it('detects editable from class name', () => {
    const xml = '<?xml version="1.0"?><hierarchy><node class="android.widget.EditText" text="" bounds="[0,0][100,50]" clickable="true" scrollable="false" enabled="true" checked="false" selected="false" focused="true" /></hierarchy>';
    const root = parseXml(xml);
    assert.strictEqual(root.editable, true);
  });

  it('returns null for empty input', () => {
    assert.strictEqual(parseXml(''), null);
    assert.strictEqual(parseXml(null), null);
    assert.strictEqual(parseXml(undefined), null);
  });

  it('returns null for ERROR: prefix', () => {
    assert.strictEqual(parseXml('ERROR: could not get idle state'), null);
  });

  it('extracts all 12 attributes correctly', () => {
    const xml = '<?xml version="1.0"?><hierarchy><node class="android.widget.CheckBox" text="Agree" content-desc="terms" resource-id="com.app:id/cb" bounds="[5,5][50,50]" clickable="true" scrollable="true" enabled="true" checked="true" selected="true" focused="true" /></hierarchy>';
    const n = parseXml(xml);
    assert.strictEqual(n.class, 'android.widget.CheckBox');
    assert.strictEqual(n.text, 'Agree');
    assert.strictEqual(n.contentDesc, 'terms');
    assert.strictEqual(n.resourceId, 'com.app:id/cb');
    assert.ok(n.bounds);
    assert.strictEqual(n.clickable, true);
    assert.strictEqual(n.scrollable, true);
    assert.strictEqual(n.editable, false);
    assert.strictEqual(n.enabled, true);
    assert.strictEqual(n.checked, true);
    assert.strictEqual(n.selected, true);
    assert.strictEqual(n.focused, true);
  });
});
