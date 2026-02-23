import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTree, shortClass } from '../../src/aria.js';

// Minimal node factory
function node(cls, text, children = [], overrides = {}) {
  return {
    class: cls,
    text: text || '',
    contentDesc: '',
    resourceId: '',
    bounds: null,
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

describe('shortClass', () => {
  it('maps core Android widgets', () => {
    assert.strictEqual(shortClass('android.widget.TextView'), 'Text');
    assert.strictEqual(shortClass('android.widget.EditText'), 'TextInput');
    assert.strictEqual(shortClass('android.widget.Button'), 'Button');
    assert.strictEqual(shortClass('android.widget.ImageView'), 'Image');
    assert.strictEqual(shortClass('android.widget.CheckBox'), 'CheckBox');
    assert.strictEqual(shortClass('android.widget.Switch'), 'Switch');
    assert.strictEqual(shortClass('android.widget.RadioButton'), 'Radio');
    assert.strictEqual(shortClass('android.widget.SeekBar'), 'Slider');
    assert.strictEqual(shortClass('android.widget.ProgressBar'), 'Progress');
    assert.strictEqual(shortClass('android.widget.Spinner'), 'Select');
    assert.strictEqual(shortClass('android.widget.RecyclerView'), 'List');
  });

  it('maps layout classes to Group', () => {
    assert.strictEqual(shortClass('android.widget.LinearLayout'), 'Group');
    assert.strictEqual(shortClass('android.widget.FrameLayout'), 'Group');
    assert.strictEqual(shortClass('android.widget.RelativeLayout'), 'Group');
  });

  it('maps AppCompat and Material classes', () => {
    assert.strictEqual(shortClass('androidx.appcompat.widget.AppCompatButton'), 'Button');
    assert.strictEqual(shortClass('androidx.appcompat.widget.AppCompatEditText'), 'TextInput');
    assert.strictEqual(shortClass('androidx.appcompat.widget.AppCompatTextView'), 'Text');
    assert.strictEqual(shortClass('com.google.android.material.button.MaterialButton'), 'Button');
    assert.strictEqual(shortClass('com.google.android.material.tabs.TabLayout'), 'TabList');
    assert.strictEqual(shortClass('com.google.android.material.tabs.TabItem'), 'Tab');
  });

  it('falls back to last segment for unknown classes', () => {
    assert.strictEqual(shortClass('com.example.CustomWidget'), 'CustomWidget');
  });

  it('returns View for empty/null class', () => {
    assert.strictEqual(shortClass(''), 'View');
    assert.strictEqual(shortClass(null), 'View');
    assert.strictEqual(shortClass(undefined), 'View');
  });
});

describe('formatTree', () => {
  it('formats single node with all fields', () => {
    const n = node('android.widget.Button', 'Submit', [], {
      ref: 3,
      contentDesc: 'submit form',
      checked: true,
      focused: true,
    });
    const out = formatTree(n);
    assert.strictEqual(out, '- Button [ref=3] "Submit" (submit form) [checked, focused]');
  });

  it('formats nested tree with indentation', () => {
    const root = node('android.widget.FrameLayout', '', [
      node('android.widget.TextView', 'Hello'),
      node('android.widget.Button', 'OK', [], { ref: 1 }),
    ]);
    const out = formatTree(root);
    const lines = out.split('\n');
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0], '- Group');
    assert.strictEqual(lines[1], '  - Text "Hello"');
    assert.strictEqual(lines[2], '  - Button [ref=1] "OK"');
  });

  it('renders disabled state', () => {
    const n = node('android.widget.Button', 'Nope', [], { enabled: false });
    const out = formatTree(n);
    assert.ok(out.includes('[disabled]'));
  });

  it('renders multiple states', () => {
    const n = node('android.widget.CheckBox', 'Agree', [], {
      checked: true,
      selected: true,
    });
    const out = formatTree(n);
    assert.ok(out.includes('[checked, selected]'));
  });

  it('omits empty text and contentDesc', () => {
    const n = node('android.widget.View', '');
    const out = formatTree(n);
    assert.strictEqual(out, '- View');
  });
});
