#!/usr/bin/env node

// baremobile POC — validate ADB + uiautomator dump + input injection
// Usage: node poc.js snapshot | tap <ref> | type <ref> "text"
// Requires: adb in PATH, device/emulator connected

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// ── ADB helpers ──────────────────────────────────────────────────────

async function adb(...args) {
  const { stdout } = await exec('adb', ['shell', ...args], { timeout: 10_000 });
  return stdout;
}

async function dumpXml() {
  const dumpPath = '/data/local/tmp/ui.xml';
  // dump to file on device, then cat back — /dev/tty doesn't work on API 35+
  // Combine into single shell command to avoid exit-code issues with adb shell
  const { stdout } = await exec('adb', ['exec-out',
    `uiautomator dump ${dumpPath} >/dev/null 2>&1; cat ${dumpPath}`], {
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const xmlStart = stdout.indexOf('<?xml');
  if (xmlStart === -1) throw new Error('No XML in uiautomator output:\n' + stdout.slice(0, 200));
  return stdout.slice(xmlStart);
}

// ── XML parser (no deps, regex-based) ────────────────────────────────

function parseXml(xml) {
  const nodes = [];
  const stack = [];
  // Match self-closing <node .../> and opening/closing tags
  const tagRe = /<node\s([^>]*?)\/?>|<\/node>/g;
  let match;

  while ((match = tagRe.exec(xml)) !== null) {
    if (match[0] === '</node>') {
      stack.pop();
      continue;
    }

    const attrs = {};
    const attrRe = /(\w[\w-]*)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(match[1])) !== null) {
      attrs[am[1]] = am[2];
    }

    const node = {
      class: attrs.class || '',
      text: attrs.text || '',
      'content-desc': attrs['content-desc'] || '',
      'resource-id': attrs['resource-id'] || '',
      bounds: parseBounds(attrs.bounds || ''),
      clickable: attrs.clickable === 'true',
      scrollable: attrs.scrollable === 'true',
      editable: (attrs.class || '').includes('EditText'),
      enabled: attrs.enabled !== 'false',
      checked: attrs.checked === 'true',
      selected: attrs.selected === 'true',
      focused: attrs.focused === 'true',
      children: [],
      depth: stack.length,
    };

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    }

    nodes.push(node);

    // Self-closing tags don't push to stack
    if (!match[0].endsWith('/>')) {
      stack.push(node);
    } else {
      // Self-closing — still push briefly for correct depth but pop immediately
      // Actually no, self-closing nodes have no children, just add to list
    }
  }

  return nodes.length > 0 ? nodes[0] : null;
}

function parseBounds(str) {
  // "[0,0][1080,1920]" → { x1, y1, x2, y2 }
  const m = str.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

// ── Ref assignment ───────────────────────────────────────────────────

function assignRefs(root) {
  let refCounter = 1;
  const refMap = new Map(); // ref → node

  function walk(node) {
    if (node.clickable || node.editable || node.scrollable) {
      node.ref = refCounter++;
      refMap.set(node.ref, node);
    }
    for (const child of node.children) walk(child);
  }

  walk(root);
  return refMap;
}

// ── Pruning ──────────────────────────────────────────────────────────

function shouldKeep(node) {
  // Keep if: has ref, has text/desc, or has kept children
  if (node.ref) return true;
  if (node.text && node.text !== '') return true;
  if (node['content-desc'] && node['content-desc'] !== '') return true;
  if (node.checked || node.selected || node.focused) return true;
  return false;
}

function prune(node) {
  // Recursively prune children first
  node.children = node.children.map(prune).filter(Boolean);

  // Collapse single-child wrappers with no useful info
  if (!shouldKeep(node) && node.children.length === 1) {
    return node.children[0];
  }

  // Drop empty leaves with no useful info
  if (!shouldKeep(node) && node.children.length === 0) {
    return null;
  }

  return node;
}

// ── YAML formatter ───────────────────────────────────────────────────

function formatYaml(node, indent = 0) {
  const pad = '  '.repeat(indent);
  const parts = [];

  // Role from class name (last segment)
  const role = shortClass(node.class);

  // Build label
  let label = role;
  if (node.ref) label += ` [ref=${node.ref}]`;
  if (node.text) label += ` "${node.text}"`;
  if (node['content-desc']) label += ` (${node['content-desc']})`;

  // States
  const states = [];
  if (node.checked) states.push('checked');
  if (node.selected) states.push('selected');
  if (node.focused) states.push('focused');
  if (!node.enabled) states.push('disabled');
  if (states.length) label += ` [${states.join(', ')}]`;

  parts.push(`${pad}- ${label}`);

  for (const child of node.children) {
    parts.push(formatYaml(child, indent + 1));
  }

  return parts.join('\n');
}

function shortClass(cls) {
  if (!cls) return 'View';
  const last = cls.split('.').pop();
  // Common Android → short names
  const map = {
    'TextView': 'Text',
    'EditText': 'TextInput',
    'Button': 'Button',
    'ImageView': 'Image',
    'ImageButton': 'ImageButton',
    'CheckBox': 'CheckBox',
    'Switch': 'Switch',
    'RadioButton': 'Radio',
    'ToggleButton': 'Toggle',
    'SeekBar': 'Slider',
    'ProgressBar': 'Progress',
    'Spinner': 'Select',
    'RecyclerView': 'List',
    'ListView': 'List',
    'ScrollView': 'ScrollView',
    'LinearLayout': 'Group',
    'RelativeLayout': 'Group',
    'FrameLayout': 'Group',
    'ConstraintLayout': 'Group',
    'CoordinatorLayout': 'Group',
    'ViewGroup': 'Group',
  };
  return map[last] || last;
}

// ── Actions ──────────────────────────────────────────────────────────

function boundsCenter(bounds) {
  if (!bounds) throw new Error('Node has no bounds');
  const x = Math.round((bounds.x1 + bounds.x2) / 2);
  const y = Math.round((bounds.y1 + bounds.y2) / 2);
  return { x, y };
}

async function tap(refMap, ref) {
  const node = refMap.get(ref);
  if (!node) throw new Error(`No node with ref=${ref}`);
  const { x, y } = boundsCenter(node.bounds);
  console.log(`Tapping ref=${ref} at (${x}, ${y}) — ${shortClass(node.class)} "${node.text || node['content-desc'] || ''}"`)
  await adb('input', 'tap', String(x), String(y));
  console.log('OK');
}

async function type(refMap, ref, text) {
  const node = refMap.get(ref);
  if (!node) throw new Error(`No node with ref=${ref}`);
  const { x, y } = boundsCenter(node.bounds);
  console.log(`Typing into ref=${ref} at (${x}, ${y}) — "${text}"`);
  // Tap to focus, wait for UI to settle
  await adb('input', 'tap', String(x), String(y));
  await new Promise(r => setTimeout(r, 500));
  // Type word-by-word, inject KEYCODE_SPACE (62) between words
  // %s trick doesn't work on API 35+
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    if (i > 0) await adb('input', 'keyevent', '62'); // SPACE
    const escaped = words[i].replace(/[&|;$`"'\\<>()]/g, c => '\\' + c);
    if (escaped) await adb('input', 'text', escaped);
  }
  console.log('OK');
}

// ── Main ─────────────────────────────────────────────────────────────

async function snapshot() {
  const t0 = Date.now();
  const xml = await dumpXml();
  const t1 = Date.now();

  const root = parseXml(xml);
  if (!root) throw new Error('Failed to parse XML tree');

  const refMap = assignRefs(root);
  const pruned = prune(root);
  if (!pruned) throw new Error('Entire tree pruned away');

  const yaml = formatYaml(pruned);
  const t2 = Date.now();

  console.log(yaml);
  console.log(`\n--- ${refMap.size} interactive refs | dump: ${t1 - t0}ms | parse+format: ${t2 - t1}ms | total: ${t2 - t0}ms ---`);

  return refMap;
}

async function main() {
  const [,, cmd, ...args] = process.argv;

  if (!cmd || cmd === 'snapshot') {
    await snapshot();
  } else if (cmd === 'tap') {
    const ref = parseInt(args[0], 10);
    if (isNaN(ref)) { console.error('Usage: node poc.js tap <ref>'); process.exit(1); }
    // Need snapshot first to build refMap
    console.log('Taking snapshot to resolve refs...\n');
    const refMap = await snapshot();
    console.log('');
    await tap(refMap, ref);
  } else if (cmd === 'type') {
    const ref = parseInt(args[0], 10);
    const text = args.slice(1).join(' ');
    if (isNaN(ref) || !text) { console.error('Usage: node poc.js type <ref> "text"'); process.exit(1); }
    console.log('Taking snapshot to resolve refs...\n');
    const refMap = await snapshot();
    console.log('');
    await type(refMap, ref, text);
  } else {
    console.error(`Unknown command: ${cmd}\nUsage: node poc.js [snapshot|tap <ref>|type <ref> "text"]`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
