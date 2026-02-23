// Pruning pipeline: assign refs, collapse wrappers, drop empties, dedup

/**
 * Prune a UI tree and assign refs to interactive nodes.
 * @param {object} root — parsed XML tree from xml.js
 * @returns {{tree: object | null, refMap: Map<number, object>}}
 */
export function prune(root) {
  if (!root) return { tree: null, refMap: new Map() };

  const refMap = new Map();
  let refCounter = 1;

  // Step 1: Assign refs to interactive nodes
  function assignRefs(node) {
    if (node.clickable || node.editable || node.scrollable) {
      node.ref = refCounter++;
      refMap.set(node.ref, node);
    }
    for (const child of node.children) assignRefs(child);
  }
  assignRefs(root);

  // Step 2-4: Collapse, drop, dedup
  const tree = pruneNode(root);
  return { tree, refMap };
}

function shouldKeep(node) {
  if (node.ref) return true;
  if (node.text) return true;
  if (node.contentDesc) return true;
  if (node.checked || node.selected || node.focused) return true;
  return false;
}

const WRAPPER_CLASSES = new Set([
  'Group', 'View', 'FrameLayout', 'LinearLayout', 'RelativeLayout',
  'ConstraintLayout', 'CoordinatorLayout', 'ViewGroup',
]);

function isWrapper(node) {
  if (!node.class) return true;
  const last = node.class.split('.').pop();
  return WRAPPER_CLASSES.has(last);
}

function pruneNode(node) {
  // Recurse children first
  node.children = node.children.map(pruneNode).filter(Boolean);

  // Dedup same-text siblings at same level
  dedup(node);

  // Collapse single-child wrapper with no useful info
  if (!shouldKeep(node) && isWrapper(node) && node.children.length === 1) {
    return node.children[0];
  }

  // Drop empty leaves
  if (!shouldKeep(node) && node.children.length === 0) {
    return null;
  }

  return node;
}

function dedup(node) {
  const seen = new Set();
  node.children = node.children.filter(child => {
    if (!child.text || child.ref) return true; // keep refs and textless nodes
    const key = `${child.class}:${child.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
