// web-api.test.mjs — 保存 payload 的防御性数值 clamp（后端 maxInkValue=600000）。

import test from 'node:test';
import assert from 'node:assert/strict';

import { INK_VALUE_MAX, buildPayload, clampInkValue } from '../../js/api.js';
import { createSession } from '../../js/state.js';

test('clampInkValue：负数/NaN → 0，超限 → 600000', () => {
  assert.equal(INK_VALUE_MAX, 600000);
  assert.equal(clampInkValue(0), 0);
  assert.equal(clampInkValue(1234), 1234);
  assert.equal(clampInkValue(599999), 599999);
  assert.equal(clampInkValue(600000), 600000);
  assert.equal(clampInkValue(600001), 600000);
  assert.equal(clampInkValue(99999999), 600000);
  assert.equal(clampInkValue(-5), 0);
  assert.equal(clampInkValue('abc'), 0);
  assert.equal(clampInkValue(null), 0);
  assert.equal(clampInkValue(12.6), 13);
});

test('buildPayload：结构符合后端契约，ink 三项都被 clamp', () => {
  const session = createSession('2026-01-01T00:00:00.000Z');
  session.clientId = 'im_abcdefgh12345678';
  session.sceneId = 'spring';
  session.pre = { tight: 5, tired: 6, scattered: 4 };
  session.post = { tight: 3, tired: 3, scattered: 2, mood: 'quiet' };
  session.ink = { strokes: 900001, stamps: 700000, ms: 1200000 };
  const payload = buildPayload(session, 'data:image/webp;base64,AAAA', 'quiet');
  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.clientId, 'im_abcdefgh12345678');
  assert.equal(payload.sceneId, 'spring');
  assert.deepEqual(payload.pre, { tight: 5, tired: 6, scattered: 4 });
  assert.deepEqual(payload.post, { tight: 3, tired: 3, scattered: 2, mood: 'quiet' });
  assert.deepEqual(payload.ink, { strokes: 600000, stamps: 600000, ms: 600000 });
  assert.equal(payload.mood, 'quiet');
  assert.equal(payload.image, 'data:image/webp;base64,AAAA');
  assert.equal(typeof payload.image, 'string');
});