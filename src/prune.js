// Pruning pipeline: assign refs, collapse wrappers, drop empties, dedup
export { isInternalName };

/**
 * Prune a UI tree and assign refs to interactive nodes.
 *
 * @param {object} root — parsed XML tree from xml.js
 * @param {{maxDepth?: number, maxNodes?: number}} [opts]
 *   - maxDepth: truncate the tree below this depth (root=0). Pruned subtrees
 *     are replaced with a single "…" sentinel child so the caller still
 *     sees that there was *something* there.
 *   - maxNodes: cap the total kept-node count after pruning. Counts in
 *     post-prune walk order (DFS); excess children are dropped. Refs are
 *     not renumbered, so callers can still use a previously-snapshotted ref
 *     even if a maxNodes-bound snapshot would have hidden it.
 * @returns {{tree: object | null, refMap: Map<number, object>, truncated: boolean}}
 */
export function prune(root, opts = {}) {
  if (!root) return { tree: null, refMap: new Map(), truncated: false };

  const refMap = new Map();
  let refCounter = 1;
  let truncated = false;

  // Step 0: Optionally clamp depth. We mutate children in-place — the input
  // tree is short-lived per snapshot so this is safe.
  if (opts.maxDepth != null) {
    const maxDepth = opts.maxDepth; // capture: closures don't carry the null-narrowing
    function clamp(node, depth) {
      if (depth >= maxDepth) {
        if (node.children.length > 0) {
          truncated = true;
          node.children = [{ class: 'Truncated', text: '…',
            children: [], clickable: false, scrollable: false, editable: false,
            enabled: true, bounds: null }];
        }
        return;
      }
      for (const c of node.children) clamp(c, depth + 1);
    }
    clamp(root, 0);
  }

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
  let tree = pruneNode(root);

  // Step 5: Optionally cap the total kept-node count.
  if (tree && opts.maxNodes != null) {
    let budget = opts.maxNodes;
    function clip(node) {
      if (budget <= 0) return null;
      budget--;
      const kept = [];
      for (const c of node.children) {
        if (budget <= 0) { truncated = true; break; }
        const r = clip(c);
        if (r) kept.push(r);
      }
      if (kept.length < node.children.length) truncated = true;
      node.children = kept;
      return node;
    }
    tree = clip(tree);
  }

  return { tree, refMap, truncated };
}

// Matches internal iOS/app class names: 3+ uppercase humps or contains underscore
const INTERNAL_NAME_RE = /^[A-Z][a-zA-Z]*(?:[A-Z][a-zA-Z]*){2,}$|_/;
function isInternalName(s) { return s && INTERNAL_NAME_RE.test(s.trim()); }

function shouldKeep(node) {
  if (node.ref) return true;
  const text = node.text && !isInternalName(node.text) ? node.text : '';
  const desc = node.contentDesc && !isInternalName(node.contentDesc) ? node.contentDesc : '';
  if (text) return true;
  if (desc) return true;
  if (node.checked || node.selected || node.focused) return true;
  return false;
}

const WRAPPER_CLASSES = new Set([
  'Group', 'View', 'FrameLayout', 'LinearLayout', 'RelativeLayout',
  'ConstraintLayout', 'CoordinatorLayout', 'ViewGroup',
  // iOS wrappers
  'XCUIElementTypeOther', 'XCUIElementTypeWindow',
  'XCUIElementTypeApplication',
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
