import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, brief, timelineDesc } from '../src/timeline.mjs';
import { eventLevel, eventTitle } from '../src/model.mjs';

const ev = (type, extra = {}) => ({
  id: Math.random().toString(36).slice(2),
  ts: '2026-01-01T00:00:00.000Z',
  type,
  message: '',
  data: {},
  ...extra,
});

test('eventLevel 把事件分成里程碑与过程细节', () => {
  assert.equal(eventLevel('output'), 'milestone');
  assert.equal(eventLevel('status'), 'milestone');
  assert.equal(eventLevel('file'), 'milestone');
  assert.equal(eventLevel('command'), 'detail');
  assert.equal(eventLevel('thinking'), 'detail');
  assert.equal(eventLevel('没见过的类型'), 'detail');
});

test('eventTitle 给出以事件为主语的标题', () => {
  assert.equal(eventTitle({ type: 'created' }), '创建了这个写作任务');
  assert.equal(eventTitle({ type: 'output' }), '写作结论');
  assert.equal(eventTitle({ type: 'run_end' }), '写作结束');
  assert.equal(eventTitle({ type: '未知' }), '未知');
});

test('buildTimeline 空输入返回空数组', () => {
  assert.deepEqual(buildTimeline([]), []);
  assert.deepEqual(buildTimeline(null), []);
  assert.deepEqual(buildTimeline(undefined), []);
});

test('buildTimeline 把里程碑单独成条', () => {
  const items = buildTimeline([
    ev('created', { message: '创建' }),
    ev('output', { message: '结论正文' }),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'created');
  assert.equal(items[1].type, 'output');
  assert.equal(items[1].title, '写作结论');
  assert.equal(items[1].brief, '结论正文');
});

test('buildTimeline 把过程细节收进前一个里程碑', () => {
  const items = buildTimeline([
    ev('run_start', { message: '开始' }),
    ev('command', { message: 'ls' }),
    ev('command', { message: 'cat' }),
    ev('run_end', { message: '结束' }),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].details.length, 2, '两条 command 细节应归入 run_start');
  assert.equal(items[1].type, 'run_end');
});

test('buildTimeline 连续的 file 事件被合并成一条', () => {
  const items = buildTimeline([
    ev('file', { message: 'a.js' }),
    ev('file', { message: 'b.js' }),
    ev('file', { message: 'c.js' }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].count, 3);
  assert.match(items[0].brief, /3 个文件/);
});

test('buildTimeline 连续同类事件合并，异类不合并', () => {
  const items = buildTimeline([
    ev('status', { message: '状态变更 A' }),
    ev('status', { message: '状态变更 B' }),
    ev('output', { message: '结论' }),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].count, 2);
  assert.equal(items[1].type, 'output');
});

test('buildTimeline 首个事件是细节时也有一条兜底节点', () => {
  const items = buildTimeline([ev('command', { message: 'ls' })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'process');
  assert.equal(items[0].details.length, 1);
});

test('brief 提取计划完成度与输出首行', () => {
  assert.equal(brief(ev('plan', { data: { todos: [{ status: 'completed' }, { status: 'pending' }] } })), '1/2 项完成');
  assert.equal(brief(ev('output', { message: '第一行\n第二行' })), '第一行');
  assert.equal(brief(ev('file', { message: 'src/a.js\nsrc/b.js' })), '2 个文件');
});

test('timelineDesc 最新事件在最上面，时间相同按 id 倒序', () => {
  const items = [
    { id: 1, ts: '2026-01-01T08:00:00.000Z' },
    { id: 3, ts: '2026-01-01T10:00:00.000Z' },
    { id: 2, ts: '2026-01-01T08:00:00.000Z' },
  ];
  assert.deepEqual(timelineDesc(items).map(x => x.id), [3, 2, 1]);
  assert.deepEqual(items.map(x => x.id), [1, 3, 2], '不修改原数组');
  assert.deepEqual(timelineDesc([]), []);
  assert.deepEqual(timelineDesc(null), []);
});
