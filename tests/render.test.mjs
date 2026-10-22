import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderProjects, renderAtoms, renderAtom, renderBoard } from '../src/render.mjs';

const project = { id: 1, key: 'demo', name: '演示项目', description: '说明', atom_count: 2, open_count: 1 };
const atom = {
  id: 'AT-1', seq: 1, project_id: 1, title: '写测试', body: '任务正文',
  target: '形成一份测试报告',
  status: 'in_progress', priority: 'high', progress: 45, mentions: [{ type: 'codex', name: 'codex', raw: '@codex' }],
  thread_id: 't-1', workspace: 'C:/work', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
};

test('renderProjects 展示 key、名称与计数', () => {
  const out = renderProjects([project]);
  assert.match(out, /demo/);
  assert.match(out, /演示项目/);
  assert.match(out, /2 个选题 \/ 1 未定稿/);
});

test('renderProjects 空列表给出提示', () => {
  assert.match(renderProjects([]), /还没有项目/);
});

test('renderAtoms 展示 id、状态、标题与进度条', () => {
  const out = renderAtoms([atom]);
  assert.match(out, /AT-1/);
  assert.match(out, /写测试/);
  assert.match(out, /写作中/);
  assert.match(out, /45%/);
});

test('renderAtoms 用 ! 标记 urgent 优先级', () => {
  const out = renderAtoms([{ ...atom, priority: 'urgent' }]);
  assert.match(out, /^\s*!/m);
});

test('renderAtom 展示状态、进度、描述与时间线', () => {
  const out = renderAtom(atom, [
    { id: 1, ts: '2026-01-01T00:00:00.000Z', type: 'created', title: '创建了这个原子事件', brief: '创建', details: [] },
    { id: 2, ts: '2026-01-01T00:01:00.000Z', type: 'output', title: '写作结论', brief: '输出了结果', details: [] },
  ], [
    { kind: 'getnote', target: 'n-1', title: '某笔记' },
  ]);
  assert.match(out, /AT-1/);
  assert.match(out, /写测试/);
  assert.match(out, /写作中/);
  assert.match(out, /45%/);
  assert.match(out, /任务正文/);
  assert.match(out, /@codex/);
  assert.match(out, /某笔记/);
  assert.match(out, /写作结论/);
  assert.match(out, /输出了结果/);
  assert.match(out, /时间线/);
});

test('renderAtom 在时间线条目上标出折叠的过程细节条数', () => {
  const out = renderAtom(atom, [
    { id: 1, ts: '2026-01-01T00:01:00.000Z', type: 'output', title: '写作结论', brief: '', details: [{ type: 'command' }, { type: 'command' }] },
  ], []);
  assert.match(out, /写作结论/);
  assert.match(out, /2 条过程细节/);
});

test('renderAtom 对空事件与空链接不报错', () => {
  const out = renderAtom(atom, [], []);
  assert.match(out, /AT-1/);
  assert.match(out, /时间线/);
});

test('renderAtom 展示交付目标', () => {
  const out = renderAtom(atom, [], []);
  assert.match(out, /目标/);
  assert.match(out, /形成一份测试报告/);
});

test('renderBoard 按项目分组并按状态分栏', () => {
  const out = renderBoard([project], [
    atom,
    { ...atom, id: 'AT-2', status: 'done', progress: 100 },
  ]);
  assert.match(out, /演示项目/);
  assert.match(out, /写作中/);
  assert.match(out, /定稿/);
  assert.match(out, /AT-1/);
  assert.match(out, /AT-2/);
});

test('renderBoard 空看板给出提示', () => {
  assert.match(renderBoard([], []), /看板是空的/);
});
