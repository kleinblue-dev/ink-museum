// web-state.test.mjs — 纯逻辑单测：会话迁移守卫 / 步骤迁移 / delta / feedback / 本机持久化。
// 不依赖 DOM，可 node --test 直接跑。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  SESSION_KEY,
  SCALE_KEYS,
  backStep,
  canGoBack,
  clearAll,
  clearSession,
  computeDelta,
  createSession,
  dotPlan,
  feedbackKey,
  hashSeed,
  isClientId,
  isPostComplete,
  isPreComplete,
  isValidTransition,
  loadRawSession,
  migrateSession,
  newClientId,
  normalizeScale,
  pickFeedback,
  resetForReplay,
  saveSession
} from '../../js/state.js';

const ENV = {
  sceneIds: ['spring', 'water', 'bamboo', 'pavilion'],
  moodKeys: ['quiet', 'loose', 'far', 'empty'],
  answerKeys: ['look', 'stay', 'silent']
};

function makeStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    }
  };
}

function completePrefill() {
  return { tight: 3, tired: 4, scattered: 5 };
}

function rawSession(overrides) {
  const base = createSession('2026-01-01T00:00:00.000Z');
  base.clientId = 'im_abcdefgh12345678';
  const merged = Object.assign(base, overrides || {});
  merged.pre = Object.assign(completePrefill(), overrides && overrides.pre ? overrides.pre : {});
  return merged;
}

test('新会话字段齐备，clientId 合法', () => {
  const session = createSession('2026-01-01T00:00:00.000Z');
  assert.equal(session.schemaVersion, SCHEMA_VERSION);
  assert.match(session.clientId, /^im_[a-z0-9]{8,32}$/);
  assert.equal(session.step, 'enter');
  assert.equal(session.sceneId, null);
  assert.deepEqual(session.pre, { tight: null, tired: null, scattered: null });
  assert.deepEqual(session.post, { tight: null, tired: null, scattered: null, mood: null });
  assert.deepEqual(session.line, { answer: null, round: 0 });
  assert.deepEqual(session.ink, { strokes: 0, stamps: 0, ms: 0 });
  assert.equal(session.finishedAt, null);
  assert.equal(newClientId() === newClientId(), false);
  assert.equal(isClientId('im_abcdefgh12345678'), true);
  assert.equal(isClientId('im_short'), false);
  assert.equal(isClientId('xx_abcdefgh12345678'), false);
});

test('normalizeScale 只接受 1..7 整数', () => {
  assert.equal(normalizeScale(1), 1);
  assert.equal(normalizeScale('7'), 7);
  assert.equal(normalizeScale(3.4), 3);
  assert.equal(normalizeScale(0), null);
  assert.equal(normalizeScale(8), null);
  assert.equal(normalizeScale('x'), null);
  assert.equal(normalizeScale(null), null);
});

test('迁移：空数据/坏数据 → 重开', () => {
  const empty = migrateSession(null, ENV);
  assert.equal(empty.note, 'reset');
  assert.equal(empty.session.step, 'enter');
  const broken = migrateSession('not-an-object', ENV);
  assert.equal(broken.note, 'reset');
  const badVersion = migrateSession(rawSession({ schemaVersion: '0.9.0', step: 'scene' }), ENV);
  assert.equal(badVersion.note, 'reset');
  assert.equal(badVersion.session.step, 'enter');
  // 版本升级时保留匿名编号，保证馆藏身份连续
  assert.equal(badVersion.session.clientId, 'im_abcdefgh12345678');
});

test('迁移：未知 step → 重开', () => {
  const result = migrateSession(rawSession({ step: 'unknown-step' }), ENV);
  assert.equal(result.note, 'reset');
  assert.equal(result.session.step, 'enter');
});

test('迁移：已有墨迹的步骤一律回到 scene 并标记墨已干', () => {
  for (const step of ['ink', 'post', 'reveal']) {
    const raw = rawSession({
      step,
      sceneId: 'spring',
      line: { answer: 'look', round: 1 },
      post: { tight: 2, tired: 2, scattered: 2, mood: 'quiet' },
      ink: { strokes: 3, stamps: 1, ms: 1200 },
      finishedAt: '2026-01-01T00:05:00.000Z'
    });
    const result = migrateSession(raw, ENV);
    assert.equal(result.note, 'dryInk', step);
    assert.equal(result.session.step, 'scene', step);
    assert.equal(result.session.sceneId, null, step);
    assert.deepEqual(result.session.ink, { strokes: 0, stamps: 0, ms: 0 }, step);
    assert.deepEqual(result.session.post, { tight: null, tired: null, scattered: null, mood: null }, step);
    assert.equal(result.session.line.answer, null, step);
    assert.equal(result.session.finishedAt, null, step);
  }
});

test('迁移：缺前置数据时逐级回退（不回退过头）', () => {
  const noPre = rawSession({ step: 'line', sceneId: 'spring', line: { answer: 'look', round: 1 } });
  noPre.pre = { tight: null, tired: 4, scattered: 4 };
  assert.equal(migrateSession(noPre, ENV).session.step, 'pre');

  const noScene = rawSession({ step: 'line', sceneId: null, line: { answer: 'look', round: 1 } });
  assert.equal(migrateSession(noScene, ENV).session.step, 'scene');

  const badScene = rawSession({ step: 'ink', sceneId: 'not-a-scene', line: { answer: 'look', round: 1 } });
  assert.equal(migrateSession(badScene, ENV).session.step, 'scene');

  const noAnswer = rawSession({ step: 'line', sceneId: 'water', line: { answer: null, round: 0 } });
  assert.equal(migrateSession(noAnswer, ENV).session.step, 'line');
});

test('迁移：合法中断可恢复原步骤与数值', () => {
  const raw = rawSession({
    step: 'pre',
    pre: { tight: 1, tired: 6, scattered: 2 },
    flags: { sound: true }
  });
  const result = migrateSession(raw, ENV);
  assert.equal(result.note, null);
  assert.equal(result.session.step, 'pre');
  assert.deepEqual(result.session.pre, { tight: 1, tired: 6, scattered: 2 });
  assert.equal(result.session.flags.sound, true);

  const sceneRaw = rawSession({ step: 'scene', sceneId: 'pavilion' });
  const sceneResult = migrateSession(sceneRaw, ENV);
  assert.equal(sceneResult.note, null);
  assert.equal(sceneResult.session.step, 'scene');
  assert.equal(sceneResult.session.sceneId, 'pavilion');
});

test('迁移：非法 mood / answer 被清洗为 null', () => {
  const raw = rawSession({
    step: 'line',
    sceneId: 'spring',
    line: { answer: 'dance', round: 1 },
    post: { tight: 2, tired: 2, scattered: 2, mood: 'angry' }
  });
  const result = migrateSession(raw, ENV);
  assert.equal(result.session.post.mood, null);
  assert.equal(result.session.line.answer, null);
  assert.equal(result.session.step, 'line');
  assert.equal(result.note, null);
});

test('步骤迁移守卫：只允许前进一格或后退一格，reveal 锁定', () => {
  assert.equal(isValidTransition('enter', 'pre'), true);
  assert.equal(isValidTransition('pre', 'scene'), true);
  assert.equal(isValidTransition('ink', 'post'), true);
  assert.equal(isValidTransition('post', 'reveal'), true);
  assert.equal(isValidTransition('pre', 'enter'), true);
  assert.equal(isValidTransition('pre', 'line'), false);
  assert.equal(isValidTransition('enter', 'scene'), false);
  assert.equal(isValidTransition('reveal', 'post'), false);
  assert.equal(isValidTransition('reveal', 'enter'), false);
  assert.equal(isValidTransition('nope', 'pre'), false);
  assert.equal(backStep('enter'), null);
  assert.equal(backStep('pre'), 'enter');
  assert.equal(backStep('ink'), 'line');
  assert.equal(backStep('reveal'), null);
  assert.equal(canGoBack('reveal'), false);
  assert.equal(canGoBack('post'), true);
});

test('完成度判定', () => {
  const session = createSession();
  assert.equal(isPreComplete(session), false);
  session.pre = { tight: 1, tired: 2, scattered: 3 };
  assert.equal(isPreComplete(session), true);
  assert.equal(isPostComplete(session), false);
  session.post = { tight: 1, tired: 2, scattered: 3, mood: 'quiet' };
  assert.equal(isPostComplete(session), true);
});

test('delta：正数=松一点，缺失值跳过', () => {
  const delta = computeDelta({ tight: 6, tired: 5, scattered: 4 }, { tight: 3, tired: 5, scattered: 6 });
  assert.equal(delta.tight, 3);
  assert.equal(delta.tired, 0);
  assert.equal(delta.scattered, -2);
  assert.equal(delta.total, 1);
  assert.equal(delta.known, 3);
  assert.equal(delta.maxAbs, 3);

  const partial = computeDelta({ tight: 6, tired: null, scattered: 4 }, { tight: 3, tired: 5, scattered: 2 });
  assert.equal(partial.known, 2);
  assert.equal(partial.total, 5);
});

test('feedback：按总 delta 选组，带种子稳定', () => {
  assert.equal(feedbackKey(3), 'better');
  assert.equal(feedbackKey(0), 'same');
  assert.equal(feedbackKey(-2), 'worse');
  const feedback = {
    better: ['松了一点。', '轻了一点。'],
    same: ['还是那样，也没关系。'],
    worse: ['今天不松，也可以。']
  };
  const better = pickFeedback({ total: 4 }, feedback, 'seed-a');
  assert.ok(feedback.better.includes(better));
  assert.equal(pickFeedback({ total: 4 }, feedback, 'seed-a'), better);
  assert.equal(pickFeedback({ total: 0 }, feedback, 'seed-b'), '还是那样，也没关系。');
  assert.equal(pickFeedback({ total: -3 }, feedback, 'seed-c'), '今天不松，也可以。');
  // 缺失分组时退回 same
  assert.equal(pickFeedback({ total: 2 }, { same: ['S'] }, 'x'), 'S');
  assert.equal(pickFeedback({ total: 2 }, {}, 'x'), '');
  assert.equal(typeof hashSeed('abc'), 'number');
});

test('dotPlan：三墨点 tone 对应前后变化', () => {
  const plan = dotPlan({ tight: 6, tired: 2, scattered: 4 }, { tight: 3, tired: 6, scattered: 4 });
  assert.equal(plan.length, 3);
  assert.equal(plan[0].key, 'tight');
  assert.equal(plan[0].tone, 'better');
  assert.equal(plan[1].tone, 'worse');
  assert.equal(plan[2].tone, 'same');
  assert.deepEqual(
    plan.map((entry) => entry.tone),
    ['better', 'worse', 'same']
  );
});

test('resetForReplay：保留编号与来时，回到 scene', () => {
  const session = createSession('2026-01-01T00:00:00.000Z');
  session.pre = { tight: 2, tired: 3, scattered: 4 };
  session.sceneId = 'spring';
  session.line = { answer: 'look', round: 1 };
  session.post = { tight: 1, tired: 1, scattered: 1, mood: 'quiet' };
  session.ink = { strokes: 9, stamps: 2, ms: 800 };
  session.finishedAt = '2026-01-01T00:06:00.000Z';
  const next = resetForReplay(session);
  assert.equal(next.step, 'scene');
  assert.equal(next.clientId, session.clientId);
  assert.deepEqual(next.pre, { tight: 2, tired: 3, scattered: 4 });
  assert.equal(next.sceneId, null);
  assert.deepEqual(next.ink, { strokes: 0, stamps: 0, ms: 0 });
  assert.equal(next.finishedAt, null);
});

test('本机持久化：存取/损坏数据/配额异常', () => {
  const storage = makeStorage();
  const session = createSession('2026-01-01T00:00:00.000Z');
  assert.equal(saveSession(storage, session), true);
  const raw = loadRawSession(storage);
  assert.equal(raw.clientId, session.clientId);
  assert.equal(raw.step, 'enter');

  storage.setItem(SESSION_KEY, '{broken json');
  assert.equal(loadRawSession(storage), null);

  let removed = false;
  clearSession(storage);
  assert.equal(storage.getItem(SESSION_KEY), null);

  const failing = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error('quota');
    },
    removeItem() {
      removed = true;
    }
  };
  assert.equal(saveSession(failing, session), false);
  clearAll(failing);
  assert.equal(removed, true);
});

test('SCALE_KEYS 与 content 的 pre items 顺序一致（避免写死 key 偏离）', async () => {
  const { CONTENT } = await import('../../content/content.js');
  const keys = CONTENT.pre.items.map((item) => item.key);
  assert.deepEqual(keys, SCALE_KEYS);
});