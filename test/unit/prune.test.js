import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prune } from '../../src/prune.js';

// Factory for building test trees
function node(cls, text, children = [], overrides = {}) {
  return {
    class: cls,
    text: text || '',
    contentDesc: '',
    resourceId: '',
    bounds: { x1: 0, y1: 0, x2: 100, y2: 50 },
    clickable: false,
    scrollable: false,
    editable: false,
    enabled: true,
    checked: false,
    selected: false,
    focused: false,
    children,
    ...overrides,
  };
}

describe('prune', () => {
  it('collapses single-child wrapper', () => {
    const root = node('android.widget.FrameLayout', '', [
      node('android.widget.TextView', 'Hello'),
    ]);
    const { tree } = prune(root);
    assert.strictEqual(tree.text, 'Hello');
    assert.strictEqual(tree.class, 'android.widget.TextView');
  });

  it('keeps node with ref even if no text', () => {
    const root = node('android.widget.Button', '', [], { clickable: true });
    const { tree, refMap } = prune(root);
    assert.ok(tree);
    assert.ok(tree.ref);
    assert.strictEqual(refMap.size, 1);
  });

  it('drops empty leaf with no useful info', () => {
    const root = node('android.widget.FrameLayout', '', [
      node('android.widget.View', ''),
      node('android.widget.TextView', 'Keep me'),
    ]);
    const { tree } = prune(root);
    // Wrapper should collapse since one child dropped and one remains
    assert.strictEqual(tree.text, 'Keep me');
  });

  it('assigns refs only on interactive nodes', () => {
    const root = node('android.widget.FrameLayout', '', [
      node('android.widget.TextView', 'Static'),
      node('android.widget.Button', 'Click', [], { clickable: true }),
      node('android.widget.EditText', 'Input', [], { editable: true }),
    ]);
    const { refMap } = prune(root);
    assert.strictEqual(refMap.size, 2);
    for (const [, n] of refMap) {
      assert.ok(n.clickable || n.editable);
    }
  });

  it('deduplicates same-text siblings', () => {
    const root = node('android.widget.LinearLayout', '', [
      node('android.widget.TextView', 'Repeated'),
      node('android.widget.TextView', 'Repeated'),
      node('android.widget.TextView', 'Repeated'),
      node('android.widget.TextView', 'Unique'),
    ]);
    const { tree } = prune(root);
    const textChildren = tree.children.filter(c => c.text === 'Repeated');
    assert.strictEqual(textChildren.length, 1);
    assert.strictEqual(tree.children.length, 2);
  });

  it('does not dedup nodes with refs', () => {
    const root = node('android.widget.LinearLayout', 'list', [
      node('android.widget.Button', 'OK', [], { clickable: true }),
      node('android.widget.Button', 'OK', [], { clickable: true }),
    ]);
    const { tree, refMap } = prune(root);
    assert.strictEqual(refMap.size, 2);
    const buttons = tree.children.filter(c => c.text === 'OK');
    assert.strictEqual(buttons.length, 2);
  });

  it('returns tree and refMap', () => {
    const root = node('android.widget.TextView', 'Hello');
    const result = prune(root);
    assert.ok('tree' in result);
    assert.ok('refMap' in result);
    assert.ok(result.refMap instanceof Map);
  });

  it('handles null root', () => {
    const { tree, refMap } = prune(null);
    assert.strictEqual(tree, null);
    assert.strictEqual(refMap.size, 0);
  });

  it('keeps node with contentDesc', () => {
    const root = node('android.widget.ImageView', '', [], { contentDesc: 'logo' });
    const { tree } = prune(root);
    assert.ok(tree);
    assert.strictEqual(tree.contentDesc, 'logo');
  });

  it('keeps node with special state', () => {
    const root = node('android.widget.View', '', [], { checked: true });
    const { tree } = prune(root);
    assert.ok(tree);
  });
});
