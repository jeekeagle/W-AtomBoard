import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUSES, STATUS_KEYS, PRIORITIES,
  isStatus, isPriority, canTransition, allowedTransitions,
  labelOf, statusColor, progressForStatus,
} from '../src/model.mjs';
import { ONTOLOGY } from '../src/ontology.mjs';

test('状态与优先级枚举自洽', () => {
  assert.equal(STATUS_KEYS.length, STATUSES.length);
  assert.equal(new Set(STATUS_KEYS).size, STATUS_KEYS.length, '状态 key 不能重复');
  assert.ok(STATUS_KEYS.includes('idea'));
  assert.ok(STATUS_KEYS.includes('todo'));
  assert.ok(STATUS_KEYS.includes('in_progress'));
  assert.ok(STATUS_KEYS.includes('in_review'));
  assert.ok(STATUS_KEYS.includes('done'));
  assert.deepEqual(PRIORITIES, ['low', 'normal', 'high', 'urgent']);
});

test('isStatus / isPriority 判定', () => {
  assert.equal(isStatus('todo'), true);
  assert.equal(isStatus('done-ish'), false);
  assert.equal(isStatus(undefined), false);
  assert.equal(isPriority('urgent'), true);
  assert.equal(isPriority('critical'), false);
});

test('状态机：同状态自环合法，非法跳转被拒', () => {
  assert.equal(canTransition('todo', 'todo'), true);
  assert.equal(canTransition('todo', 'in_progress'), true);
  assert.equal(canTransition('todo', 'done'), false, 'todo 不能直接跳到 done');
  assert.equal(canTransition('idea', 'in_progress'), false, 'idea 必须先 todo');
  assert.equal(canTransition('done', 'in_progress'), true, 'done 可回退重开');
});

test('状态机：每个状态的出边集合与 allowedTransitions 一致', () => {
  for (const from of STATUS_KEYS) {
    for (const to of STATUS_KEYS) {
      const expected = from === to ? true : allowedTransitions(from).includes(to);
      assert.equal(canTransition(from, to), expected, `${from} → ${to}`);
    }
  }
});

test('状态机：每个状态都有出边（除自环外不会成为死胡同）', () => {
  for (const s of STATUS_KEYS) {
    assert.ok(allowedTransitions(s).length > 0, `${s} 没有可去的状态`);
  }
});

test('状态机：出边只指向已知状态', () => {
  for (const s of STATUS_KEYS) {
    for (const to of allowedTransitions(s)) {
      assert.ok(STATUS_KEYS.includes(to), `${s} → ${to} 指向了未知状态`);
    }
  }
});

test('模型与信息本体描述同一套状态机', () => {
  const sm = ONTOLOGY.stateMachine;
  assert.ok(sm, '本体应声明状态机');
  assert.deepEqual([...sm.statuses].sort(), [...STATUS_KEYS].sort(), '本体与模型的状态列表不一致');
  for (const from of STATUS_KEYS) {
    const fromOntology = [...(sm.transitions[from] || [])].sort();
    const fromModel = [...allowedTransitions(from)].sort();
    assert.deepEqual(fromOntology, fromModel, `${from} 的出边在本体与模型里不一致`);
  }
});

test('labelOf / statusColor 有中文标签与合法色值', () => {
  assert.equal(labelOf('in_progress'), '写作中');
  assert.equal(labelOf('in_review'), '待审校');
  assert.equal(labelOf('unknown-key'), 'unknown-key', '未知状态回退为 key 本身');
  for (const s of STATUSES) {
    assert.match(s.color, /^#[0-9a-f]{6}$/i, `${s.key} 色值格式`);
    assert.equal(statusColor(s.key), s.color);
  }
  assert.equal(statusColor('nope'), '#8b8fa3');
});

test('progressForStatus 映射落在 0..100', () => {
  assert.equal(progressForStatus('todo'), 0);
  assert.equal(progressForStatus('in_progress'), 50);
  assert.equal(progressForStatus('in_review'), 85);
  assert.equal(progressForStatus('done'), 100);
  assert.equal(progressForStatus('bogus'), 0);
  for (const s of STATUS_KEYS) {
    const p = progressForStatus(s);
    assert.ok(p >= 0 && p <= 100, `${s} 进度越界：${p}`);
  }
});
