import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid } from '../../src/interact.js';

describe('buildGrid', () => {
  it('creates 10 columns with auto-sized rows', () => {
    const g = buildGrid(1080, 2400);
    assert.strictEqual(g.cols, 10);
    assert.strictEqual(g.cellW, 108);
    assert.ok(g.rows > 10, 'Should have many rows for tall screen');
    assert.ok(g.cellH > 0);
  });

  it('resolves A1 to top-left cell center', () => {
    const g = buildGrid(1080, 2400);
    const { x, y } = g.resolve('A1');
    assert.strictEqual(x, Math.round(g.cellW / 2));
    assert.strictEqual(y, Math.round(g.cellH / 2));
  });

  it('resolves J and last row to bottom-right cell center', () => {
    const g = buildGrid(1080, 2400);
    const { x, y } = g.resolve('J' + g.rows);
    assert.ok(x > 900, 'Should be near right edge');
    assert.ok(y > 2200, 'Should be near bottom edge');
  });

  it('is case-insensitive', () => {
    const g = buildGrid(1080, 2400);
    const upper = g.resolve('C5');
    const lower = g.resolve('c5');
    assert.deepStrictEqual(upper, lower);
  });

  it('throws on invalid cell format', () => {
    const g = buildGrid(1080, 2400);
    assert.throws(() => g.resolve('Z1'), /Invalid grid cell/);
    assert.throws(() => g.resolve(''), /Invalid grid cell/);
    assert.throws(() => g.resolve('11'), /Invalid grid cell/);
  });

  it('throws on out-of-range row', () => {
    const g = buildGrid(1080, 2400);
    assert.throws(() => g.resolve('A999'), /Row out of range/);
    assert.throws(() => g.resolve('A0'), /Row out of range/);
  });

  it('text includes screen dimensions and grid info', () => {
    const g = buildGrid(1080, 2400);
    assert.ok(g.text.includes('1080×2400'));
    assert.ok(g.text.includes('10 cols'));
    assert.ok(g.text.includes('ABCDEFGHIJ'));
  });
});
