// Interaction primitives — tap, type, press, swipe, scroll, long-press

import { shell } from './adb.js';

const KEY_MAP = {
  back: 4, home: 3, enter: 66, delete: 67, tab: 61, escape: 111,
  up: 19, down: 20, left: 21, right: 22, space: 62, power: 26,
  volup: 24, voldown: 25, recent: 187,
};

function boundsCenter(bounds) {
  if (!bounds) throw new Error('Node has no bounds');
  return {
    x: Math.round((bounds.x1 + bounds.x2) / 2),
    y: Math.round((bounds.y1 + bounds.y2) / 2),
  };
}

function resolveRef(ref, refMap) {
  const node = refMap.get(ref);
  if (!node) throw new Error(`No node with ref=${ref}`);
  return node;
}

/**
 * Tap a node by ref.
 */
export async function tap(ref, refMap, opts = {}) {
  const node = resolveRef(ref, refMap);
  const { x, y } = boundsCenter(node.bounds);
  await shell(`input tap ${x} ${y}`, opts);
}

/**
 * Type text into a node by ref.
 * Skips focus tap if node is already focused.
 * opts.clear: select-all + delete before typing.
 */
export async function type(ref, text, refMap, opts = {}) {
  const node = resolveRef(ref, refMap);
  // Only tap to focus if not already focused
  if (!node.focused) {
    const { x, y } = boundsCenter(node.bounds);
    await shell(`input tap ${x} ${y}`, opts);
    await new Promise(r => setTimeout(r, 500));
  }
  // Clear existing content if requested (move to end, batch-delete 50 chars)
  if (opts.clear) {
    const deletes = ' 67'.repeat(50); // KEYCODE_DELETE × 50
    await shell(`input keyevent 123${deletes}`, opts); // MOVE_END then delete
    await new Promise(r => setTimeout(r, 300));
  }
  // Type word-by-word with KEYCODE_SPACE between (API 35+ fix)
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    if (i > 0) await shell('input keyevent 62', opts);
    const escaped = words[i].replace(/[&|;$`"'\\<>()]/g, c => '\\' + c);
    if (escaped) await shell(`input text '${escaped}'`, opts);
  }
}

/**
 * Press a key by name (back, home, enter, etc.) or keycode number.
 */
export async function press(key, opts = {}) {
  const code = KEY_MAP[key] ?? key;
  if (typeof code !== 'number' && isNaN(Number(code))) {
    throw new Error(`Unknown key: ${key}. Known: ${Object.keys(KEY_MAP).join(', ')}`);
  }
  await shell(`input keyevent ${code}`, opts);
}

/**
 * Raw swipe between two points.
 */
export async function swipe(x1, y1, x2, y2, duration = 300, opts = {}) {
  await shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`, opts);
}

/**
 * Scroll within a scrollable element's bounds.
 * @param {number} ref
 * @param {'up'|'down'|'left'|'right'} direction
 */
export async function scroll(ref, direction, refMap, opts = {}) {
  const node = resolveRef(ref, refMap);
  const b = node.bounds;
  if (!b) throw new Error('Scrollable node has no bounds');

  const cx = Math.round((b.x1 + b.x2) / 2);
  const cy = Math.round((b.y1 + b.y2) / 2);
  const h = b.y2 - b.y1;
  const w = b.x2 - b.x1;
  const third = Math.round(h / 3);
  const thirdW = Math.round(w / 3);

  const vectors = {
    down:  [cx, cy, cx, cy - third],
    up:    [cx, cy, cx, cy + third],
    left:  [cx, cy, cx - thirdW, cy],
    right: [cx, cy, cx + thirdW, cy],
  };

  const v = vectors[direction];
  if (!v) throw new Error(`Unknown scroll direction: ${direction}. Use up/down/left/right`);
  await swipe(...v, 300, opts);
}

/**
 * Long-press a node (zero-distance swipe with 1000ms duration).
 */
export async function longPress(ref, refMap, opts = {}) {
  const node = resolveRef(ref, refMap);
  const { x, y } = boundsCenter(node.bounds);
  await swipe(x, y, x, y, 1000, opts);
}
