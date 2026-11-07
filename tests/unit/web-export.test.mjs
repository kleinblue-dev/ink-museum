// web-export.test.mjs — 画卷合成相关的纯计算：尺寸（当前画布比例 ×2 + 上限）、构图位置、日期。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCROLL_MAX_EDGE,
  SCROLL_SCALE,
  composeCanvasSize,
  formatDate,
  parsePosition
} from '../../js/export.js';

test('合成尺寸：桌面 1440×900 → ×2', () => {
  const size = composeCanvasSize(1440, 900);
  assert.deepEqual(size, { width: 2880, height: 1800 });
});

test('合成尺寸：手机 390×844 → ×2', () => {
  const size = composeCanvasSize(390, 844);
  assert.deepEqual(size, { width: 780, height: 1688 });
});

test('合成尺寸：超长边被压到上限，比例不变', () => {
  const size = composeCanvasSize(3000, 2000);
  assert.equal(Math.max(size.width, size.height), SCROLL_MAX_EDGE);
  const ratio = size.width / size.height;
  assert.ok(Math.abs(ratio - 1.5) < 0.002);
});

test('合成尺寸：非法输入也返回可用尺寸', () => {
  for (const input of [[0, 0], [NaN, 100], [-5, -5], [null, undefined], ['', '']]) {
    const size = composeCanvasSize(input[0], input[1]);
    assert.ok(size.width >= 2);
    assert.ok(size.height >= 2);
    assert.ok(Number.isInteger(size.width));
    assert.ok(Number.isInteger(size.height));
    assert.ok(Math.max(size.width, size.height) <= SCROLL_MAX_EDGE);
  }
});

test('合成尺寸：自定义 scale / maxEdge', () => {
  const size = composeCanvasSize(500, 400, { scale: 1, maxEdge: 400 });
  assert.equal(size.width, 400);
  assert.equal(size.height, 320);
  assert.equal(SCROLL_SCALE, 2);
});

test('parsePosition：解析 content 里的 object-position', () => {
  assert.deepEqual(parsePosition('50% 42%'), { x: 0.5, y: 0.42 });
  assert.deepEqual(parsePosition('50% 50%'), { x: 0.5, y: 0.5 });
  assert.deepEqual(parsePosition('0% 100%'), { x: 0, y: 1 });
  assert.deepEqual(parsePosition(''), { x: 0.5, y: 0.5 });
  assert.deepEqual(parsePosition('abc'), { x: 0.5, y: 0.5 });
  assert.deepEqual(parsePosition(null), { x: 0.5, y: 0.5 });
});

test('formatDate：画卷落款日期', () => {
  assert.equal(formatDate(new Date(2026, 10, 7)), '2026.11.07');
  assert.equal(formatDate(new Date(2026, 0, 1)), '2026.01.01');
  assert.equal(formatDate(new Date(2026, 11, 31)), '2026.12.31');
  assert.equal(formatDate('not-a-date'), '');
});