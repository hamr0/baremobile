/**
 * Phase 4b validation:
 *   4.2 selector-based actions (ref OR {text|contentDesc})
 *   4.3 page.waitForStable / MCP wait_stable
 *   4.5 snapshot({maxDepth, maxNodes}) via prune()
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { prune } from '../../src/prune.js';
import { formatTree } from '../../src/aria.js';
import { TOOLS } from '../../mcp-server.js';

// ---------------------------------------------------------------------------
// 4.5 — bounded snapshot via prune()
// ---------------------------------------------------------------------------

function makeNode(over = {}) {
  return {
    class: 'Node', text: '', contentDesc: '', bounds: null,
    clickable: false, scrollable: false, editable: false, enabled: true,
    checked: false, selected: false, focused: false, children: [],
    ...over,
  };
}

function makeTreeDeep(depth) {
  let leaf = makeNode({ text: `leaf-${depth}`, clickable: true });
  for (let d = depth - 1; d >= 0; d--) {
    const parent = makeNode({ text: `node-${d}`, clickable: true, children: [leaf] });
    leaf = parent;
  }
  return leaf;
}

function makeTreeWide(count) {
  return makeNode({
    text: 'root',
    children: Array.from({ length: count }, (_, i) =>
      makeNode({ text: `child-${i}`, clickable: true })),
  });
}

describe('Phase 4.5 — prune({maxDepth, maxNodes})', () => {
  it('without opts, all nodes are kept (regression)', () => {
    const tree = makeTreeDeep(5);
    const { tree: out, truncated } = prune(tree);
    assert.strictEqual(truncated, false);
    let depth = 0;
    for (let n = out; n; n = n.children[0]) depth++;
    assert.ok(depth >= 5);
  });

  it('maxDepth=2 truncates a 5-deep tree to depth 2 + sentinel', () => {
    const tree = makeTreeDeep(5);
    const { tree: out, truncated } = prune(tree, { maxDepth: 2 });
    assert.strictEqual(truncated, true);
    // Walk to find the sentinel.
    let n = out;
    let depth = 0;
    while (n && n.children.length > 0 && n.children[0].class !== 'Truncated') {
      n = n.children[0];
      depth++;
    }
    assert.ok(depth <= 2, `expected depth ≤ 2, got ${depth}`);
    assert.strictEqual(n.children[0].class, 'Truncated');
    assert.strictEqual(n.children[0].text, '…');
  });

  it('maxNodes caps total kept-node count and marks truncated', () => {
    const tree = makeTreeWide(50);
    const { tree: out, truncated } = prune(tree, { maxNodes: 10 });
    let count = 0;
    function walk(n) { count++; for (const c of n.children) walk(c); }
    walk(out);
    assert.ok(count <= 10, `expected ≤10 nodes, got ${count}`);
    assert.strictEqual(truncated, true);
  });

  it('maxNodes preserves DFS order (first children kept, later ones dropped)', () => {
    const tree = makeTreeWide(20);
    const { tree: out } = prune(tree, { maxNodes: 5 });
    // Root + first 4 children.
    assert.strictEqual(out.text, 'root');
    const kids = out.children.map(c => c.text);
    for (let i = 0; i < kids.length; i++) {
      assert.strictEqual(kids[i], `child-${i}`);
    }
  });

  it('STRESS: random maxDepth/maxNodes never exceed their bounds', () => {
    for (let trial = 0; trial < 50; trial++) {
      const depth = 3 + Math.floor(Math.random() * 8);
      const width = 5 + Math.floor(Math.random() * 20);
      const tree = makeNode({
        text: 'root',
        children: Array.from({ length: width }, () => makeTreeDeep(depth)),
      });
      const maxDepth = 1 + Math.floor(Math.random() * depth);
      const maxNodes = 5 + Math.floor(Math.random() * 50);
      const { tree: out } = prune(tree, { maxDepth, maxNodes });
      let count = 0;
      let observedDepth = 0;
      function walk(n, d) {
        if (n.class !== 'Truncated') {
          count++;
          if (d > observedDepth) observedDepth = d;
        }
        for (const c of n.children) walk(c, d + 1);
      }
      if (out) walk(out, 0);
      assert.ok(count <= maxNodes, `nodes=${count} > max=${maxNodes}`);
      // The Truncated sentinel sits at maxDepth+1 by design and isn't a real
      // node — see clamp() in src/prune.js. Real nodes never exceed maxDepth.
      assert.ok(observedDepth <= maxDepth, `real-node depth=${observedDepth} > max=${maxDepth}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4.2 — selector-based actions (test against synthetic page objects so we
// don't need real ADB/WDA)
// ---------------------------------------------------------------------------

describe('Phase 4.2 — selector-based actions', () => {
  // The selector resolver is a private closure inside connect(). We
  // exercise it indirectly: confirm MCP schemas advertise the selector
  // shape, and that the implementation files reference resolveSelector
  // for each interaction.
  it('tap/type/scroll/long_press tools expose `selector` alongside `ref`', () => {
    for (const name of ['tap', 'type', 'scroll', 'long_press']) {
      const tool = TOOLS.find(t => t.name === name);
      assert.ok(tool, `${name} tool missing`);
      assert.ok(tool.inputSchema.properties.ref, `${name} must keep ref`);
      assert.ok(tool.inputSchema.properties.selector, `${name} must accept selector`);
      assert.ok(tool.inputSchema.properties.selector.properties.text);
      assert.ok(tool.inputSchema.properties.selector.properties.contentDesc);
    }
  });

  it('Android and iOS connect()s both wire resolveSelector into the interaction methods', () => {
    for (const f of ['src/index.js', 'src/ios.js']) {
      const src = readFileSync(f, 'utf8');
      assert.match(src, /resolveSelector/, `${f} must define a resolveSelector closure`);
      assert.match(src, /async tap\(refOrSelector\)/, `${f} tap must accept refOrSelector`);
      assert.match(src, /async type\(refOrSelector/, `${f} type must accept refOrSelector`);
      assert.match(src, /async scroll\(refOrSelector/, `${f} scroll must accept refOrSelector`);
      assert.match(src, /async longPress\(refOrSelector\)/, `${f} longPress must accept refOrSelector`);
    }
  });

  it('handler enforces ref-or-selector presence with a clear error', async () => {
    const { handleMessage } = await import('../../mcp-server.js');
    const raw = await handleMessage({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'tap', arguments: { platform: 'android' } },
    });
    const res = JSON.parse(raw);
    assert.ok(res.result.isError);
    assert.match(res.result.content[0].text, /tap requires `ref` or `selector`/);
  });
});

// ---------------------------------------------------------------------------
// 4.3 — wait_stable MCP tool + page.waitForStable
// ---------------------------------------------------------------------------

describe('Phase 4.3 — wait_stable', () => {
  it('wait_stable tool registered with correct schema', () => {
    const tool = TOOLS.find(t => t.name === 'wait_stable');
    assert.ok(tool, 'wait_stable tool missing');
    assert.ok(tool.inputSchema.properties.pollMs);
    assert.ok(tool.inputSchema.properties.stableMs);
    assert.ok(tool.inputSchema.properties.timeout);
    assert.strictEqual(tool.inputSchema.required, undefined);
  });

  it('Android and iOS page expose waitForStable', () => {
    for (const f of ['src/index.js', 'src/ios.js']) {
      const src = readFileSync(f, 'utf8');
      assert.match(src, /async waitForStable\(/, `${f} must define waitForStable`);
    }
  });

  // NECESSITY — without waitForStable, agents have to either sleep blindly
  // (wasted time / still racey) or rely on waitForText which only works if
  // a specific string is known ahead of time. Stability detection covers
  // the general "wait out animations" case.
  it('NECESSITY: simulated waitForStable logic resolves on a stretch of identical snapshots', async () => {
    // Snapshot stream: one transient change, then a long stable run. Use
    // a stableMs much larger than pollMs so OS scheduling jitter (a
    // single sleep occasionally landing >stableMs) can't trip an early
    // exit on the initial pair.
    const snaps = ['a', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b'];
    let i = 0;
    async function snap() { return snaps[Math.min(i++, snaps.length - 1)]; }
    async function waitForStable({ pollMs = 20, stableMs = 200, timeout = 2000 } = {}) {
      const start = Date.now();
      let prev = await snap();
      let prevAt = Date.now();
      while (Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, pollMs));
        const next = await snap();
        if (next === prev && (Date.now() - prevAt) >= stableMs) return next;
        if (next !== prev) { prev = next; prevAt = Date.now(); }
      }
      throw new Error('timeout');
    }
    const out = await waitForStable({ pollMs: 20, stableMs: 200, timeout: 2000 });
    assert.strictEqual(out, 'b');
  });
});
