/**
 * ink-engine 纯逻辑单测（node --test，不依赖 DOM）
 * ===========================================================================
 * engine.js 只有 createInkEngine 一个具名导出；纯逻辑（历史栈/坐标换算/
 * 调色板/浓淡档/尺寸/旋转）挂在 createInkEngine.pure 上。
 * 本文件不实例化引擎、不碰 canvas —— 在 Node 里 import engine.js 不会触发 DOM。
 *
 * 跑法： cd ink-museum && node --test tests/unit/ink-engine.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createInkEngine } from '../../js/ink/engine.js';

const pure = createInkEngine.pure;

test('模块导出：只有 createInkEngine 具名导出，且纯逻辑出口齐全', () => {
  assert.equal(typeof createInkEngine, 'function');
  assert.ok(pure && typeof pure === 'object', 'createInkEngine.pure 必须存在');
  const required = [
    'clamp', 'hexToRgb', 'rgbCss', 'normalizePalette', 'toneParams',
    'normalizeTone', 'normalizeSize', 'normalizeRotation',
    'normalizeColorIndex', 'coordsToNormalized', 'brushSteps', 'createHistory',
  ];
  for (const key of required){
    assert.equal(typeof pure[key], 'function', '缺少纯逻辑函数 ' + key);
  }
});

test('clamp：上下界夹住，NaN 之外的普通数原样返回', () => {
  assert.equal(pure.clamp(5, 0, 10), 5);
  assert.equal(pure.clamp(-1, 0, 10), 0);
  assert.equal(pure.clamp(11, 0, 10), 10);
  assert.equal(pure.clamp(0.5, 0.5, 2), 0.5);
});

test('hexToRgb：三位/六位/带不带 # 都认，坏值返回 null', () => {
  assert.deepEqual(pure.hexToRgb('#a35a2e'), { r: 163, g: 90, b: 46 });
  assert.deepEqual(pure.hexToRgb('a35a2e'), { r: 163, g: 90, b: 46 });
  assert.deepEqual(pure.hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
  assert.equal(pure.hexToRgb('#12345'), null);
  assert.equal(pure.hexToRgb('rgba(0,0,0,.5)'), null);
  assert.equal(pure.hexToRgb(null), null);
  assert.equal(pure.hexToRgb(123), null);
});

test('rgbCss：alpha 缺省为 1，越界夹到 0..1', () => {
  assert.equal(pure.rgbCss({ r: 1, g: 2, b: 3 }), 'rgba(1,2,3,1)');
  assert.equal(pure.rgbCss({ r: 1, g: 2, b: 3 }, 0.5), 'rgba(1,2,3,0.5)');
  assert.equal(pure.rgbCss({ r: 1, g: 2, b: 3 }, 5), 'rgba(1,2,3,1)');
});

test('调色板：非法色被过滤、空输入回落默认墨赭青朱，且赭/朱比墨"重"', () => {
  const custom = pure.normalizePalette(['#24201a', 'not-a-color', '#8a5a35', null, '#31556f', '#9e3b2e']);
  assert.equal(custom.length, 4);
  assert.equal(custom[0].css, 'rgba(36,32,26,1)');
  // 视觉重量补偿：墨 f≈1；赭/青/朱 f>1（在纸上更"轻"，要抬 alpha）
  assert.ok(custom[0].f >= 0.9 && custom[0].f <= 1.05, '墨的补偿系数应≈1，实际 ' + custom[0].f);
  assert.ok(custom[1].f > 1.1, '赭石应补偿 >1.1，实际 ' + custom[1].f);
  assert.ok(custom[2].f > 1.0, '花青应补偿 >1，实际 ' + custom[2].f);
  assert.ok(custom[3].f > 1.05, '朱砂应补偿 >1.05，实际 ' + custom[3].f);

  const fallback = pure.normalizePalette([]);
  assert.equal(fallback.length, 4);
  assert.equal(fallback[0].css, 'rgba(26,26,24,1)', '缺省第一色应是墨');
});

test('normalizeTone / toneParams：未知档回落 medium，浓墨 ink+alpha 都应更大', () => {
  assert.equal(pure.normalizeTone('dark'), 'dark');
  assert.equal(pure.normalizeTone('nope'), 'medium');
  assert.equal(pure.normalizeTone(null), 'medium');
  const light = pure.toneParams('light');
  const medium = pure.toneParams('medium');
  const dark = pure.toneParams('dark');
  assert.ok(light.ink < medium.ink && medium.ink < dark.ink, 'ink 应随浓淡单调递增');
  assert.ok(light.alpha < medium.alpha && medium.alpha < dark.alpha, 'alpha 应随浓淡单调递增');
  assert.ok(light.radius < dark.radius, '浓墨的笔尖应更宽一点');
});

test('normalizeSize：缺省 1，夹在 0.5..2', () => {
  assert.equal(pure.normalizeSize(undefined), 1);
  assert.equal(pure.normalizeSize('abc'), 1);
  assert.equal(pure.normalizeSize(0.1), 0.5);
  assert.equal(pure.normalizeSize(9), 2);
  assert.equal(pure.normalizeSize(1.25), 1.25);
});

test('normalizeRotation：任意角度归一到 0..360', () => {
  assert.equal(pure.normalizeRotation(0), 0);
  assert.equal(pure.normalizeRotation(90), 90);
  assert.equal(pure.normalizeRotation(-90), 270);
  assert.equal(pure.normalizeRotation(360), 0);
  assert.equal(pure.normalizeRotation(725), 5);
  assert.equal(pure.normalizeRotation('abc'), 0);
});

test('normalizeColorIndex：夹到调色板范围，非法回落 fallback', () => {
  assert.equal(pure.normalizeColorIndex(0, 3, 0), 0);
  assert.equal(pure.normalizeColorIndex(2, 3, 0), 2);
  assert.equal(pure.normalizeColorIndex(5, 3, 0), 2);
  assert.equal(pure.normalizeColorIndex(-2, 3, 0), 0);
  assert.equal(pure.normalizeColorIndex(1.9, 3, 0), 1);
  assert.equal(pure.normalizeColorIndex('x', 3, 2), 2);
  assert.equal(pure.normalizeColorIndex(undefined, 1, 0), 0);
});

test('coordsToNormalized：rect 换算正确，越界夹到 0..1', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(pure.coordsToNormalized(110, 70, rect), { x: 0.5, y: 0.5 });
  assert.deepEqual(pure.coordsToNormalized(10, 20, rect), { x: 0, y: 0 });
  assert.deepEqual(pure.coordsToNormalized(210, 120, rect), { x: 1, y: 1 });
  assert.deepEqual(pure.coordsToNormalized(-50, -50, rect), { x: 0, y: 0 });
  assert.deepEqual(pure.coordsToNormalized(5000, 5000, rect), { x: 1, y: 1 });
  // 拿不到 rect 时也要安全（不 NaN）
  const fallback = pure.coordsToNormalized(3, 4, null);
  assert.ok(Number.isFinite(fallback.x) && Number.isFinite(fallback.y));
});

test('brushSteps：按间距插点，终点精确、起点不含', () => {
  const steps = pure.brushSteps(0, 0, 1, 0, 0.25);
  assert.equal(steps.length, 4);
  assert.deepEqual(steps[3], { x: 1, y: 0, t: 1 });
  assert.ok(steps[0].x > 0 && steps[0].x <= 0.25);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].x > steps[i - 1].x);
  // 间距大于位移：至少一个点到终点
  const one = pure.brushSteps(0, 0, 0.1, 0, 10);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0], { x: 0.1, y: 0, t: 1 });
  // 斜线终点精确
  const diag = pure.brushSteps(0, 0, 0.6, 0.8, 0.2);
  assert.deepEqual(diag[diag.length - 1], { x: 0.6, y: 0.8, t: 1 });
});

test('历史栈：push/undo 是后进先出，空栈 undo 返回 null', () => {
  const h = pure.createHistory({ maxUndo: 10 });
  assert.equal(h.canUndo(), false);
  assert.equal(h.undo(), null);
  h.push('a'); h.push('b'); h.push('c');
  assert.equal(h.length, 3);
  assert.equal(h.depth(), 3);
  assert.equal(h.peek(), 'c');
  assert.equal(h.undo(), 'c');
  assert.equal(h.undo(), 'b');
  assert.equal(h.length, 1);
  assert.equal(h.undo(), 'a');
  assert.equal(h.canUndo(), false);
  assert.equal(h.undo(), null);
});

test('历史栈：可撤步数封顶 maxUndo，但视觉历史全部保留', () => {
  const h = pure.createHistory({ maxUndo: 3 });
  for (let i = 0; i < 6; i++) h.push(i);
  assert.equal(h.length, 6, '历史条目不能丢（重放要用）');
  assert.equal(h.depth(), 3, '可撤步数必须封顶 3');
  assert.equal(h.undo(), 5);
  assert.equal(h.undo(), 4);
  assert.equal(h.undo(), 3);
  assert.equal(h.undo(), null, '三条之后不能再撤');
  assert.equal(h.length, 3, '不能把不可撤的老墨撤掉');
});

test('历史栈：removeAt/insertAt 支持提起重摆与取消放回', () => {
  const h = pure.createHistory({ maxUndo: 10 });
  h.push('a'); h.push('b'); h.push('c');
  const removed = h.removeAt(1);
  assert.equal(removed, 'b');
  assert.equal(h.length, 2);
  assert.equal(h.insertAt(1, removed), 1);
  assert.equal(h.at(1), 'b');
  assert.equal(h.length, 3);
  // 非法下标不炸
  assert.equal(h.removeAt(-1), null);
  assert.equal(h.removeAt(99), null);
});

test('历史栈：bake 把不可撤的老条目摘走，floor 相应回落', () => {
  const h = pure.createHistory({ maxUndo: 2 });
  for (let i = 0; i < 5; i++) h.push(i);
  assert.equal(h.bakeCount(), 3);
  const baked = h.bake(3);
  assert.deepEqual(baked, [0, 1, 2]);
  assert.equal(h.length, 2);
  assert.equal(h.depth(), 2);
  assert.equal(h.bakeCount(), 0);
  assert.equal(h.undo(), 4);
  assert.equal(h.undo(), 3);
  assert.equal(h.undo(), null);
});

test('历史栈：clear 之后不可撤且长度归零', () => {
  const h = pure.createHistory({ maxUndo: 5 });
  h.push(1); h.push(2);
  h.clear();
  assert.equal(h.length, 0);
  assert.equal(h.depth(), 0);
  assert.equal(h.canUndo(), false);
  assert.equal(h.undo(), null);
});

test('unexported 约定：engine.js 不产生 default 导出', async () => {
  // 动态 import 仅测试内使用，用来断言模块面只有 createInkEngine；
  // engine.js 本体不含任何动态 import / default export。
  const mod = await import('../../js/ink/engine.js');
  assert.deepEqual(Object.keys(mod), ['createInkEngine']);
  assert.equal(mod.default, undefined);
});