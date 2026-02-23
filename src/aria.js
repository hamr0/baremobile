// Format pruned UI tree as YAML-like text with [ref=N] markers

const CLASS_MAP = {
  // Core Android widgets
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
  // AppCompat / Material
  'AppCompatButton': 'Button',
  'AppCompatEditText': 'TextInput',
  'AppCompatTextView': 'Text',
  'MaterialButton': 'Button',
  'TabLayout': 'TabList',
  'TabItem': 'Tab',
};

/**
 * Map Android class name to short role name.
 * @param {string} className — fully-qualified or simple class name
 * @returns {string}
 */
export function shortClass(className) {
  if (!className) return 'View';
  const last = className.split('.').pop();
  return CLASS_MAP[last] || last;
}

/**
 * Format a pruned node tree as YAML-like indented text.
 * @param {object} node
 * @param {number} [depth=0]
 * @returns {string}
 */
export function formatTree(node, depth = 0) {
  const pad = '  '.repeat(depth);
  let label = shortClass(node.class);

  if (node.ref) label += ` [ref=${node.ref}]`;
  if (node.text) label += ` "${node.text}"`;
  if (node.contentDesc) label += ` (${node.contentDesc})`;

  const states = [];
  if (node.checked) states.push('checked');
  if (node.selected) states.push('selected');
  if (node.focused) states.push('focused');
  if (!node.enabled) states.push('disabled');
  if (states.length) label += ` [${states.join(', ')}]`;

  const lines = [`${pad}- ${label}`];
  for (const child of node.children) {
    lines.push(formatTree(child, depth + 1));
  }
  return lines.join('\n');
}
