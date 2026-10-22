import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrompt, parseEventLine, summarizeItem, progressFromTodos, buildCommand, resolveCodexBin,
} from '../src/runner.mjs';

const atom = {
  id: 'AT-11',
  title: '测试',
  body: '任务描述正文',
};

test('buildPrompt 包含任务描述与执行边界', () => {
  const p = buildPrompt(atom, [{ type: 'codex', name: 'codex', runner: 'codex' }]);
  assert.match(p, /AT-11/);
  assert.match(p, /任务描述/);
  assert.match(p, /任务描述正文/);
  assert.match(p, /执行边界/);
  assert.match(p, /禁止执行 watomboard 命令/);
  assert.match(p, /不要修改 W-AtomBoard 自身的数据库与配置/);
  assert.match(p, /输出要求/);
});

test('buildPrompt 对有 skill 文件的 mention 注入 $技能名', () => {
  const p = buildPrompt(atom, [{
    type: 'skill', name: 'atom-board', runner: 'codex',
    skillFile: 'C:/skills/atom-board/SKILL.md',
  }]);
  assert.match(p, /\$atom-board/);
  assert.match(p, /指定技能/);
});

test('buildPrompt 注入自定义 Agent 的提示词', () => {
  const p = buildPrompt(atom, [{
    type: 'agent', name: 'critic', runner: 'codex',
    agent: { name: 'critic', prompt: '只挑刺不动手' },
  }]);
  assert.match(p, /指定 Agent/);
  assert.match(p, /只挑刺不动手/);
});

test('buildPrompt 注入得到大脑笔记上下文', () => {
  const p = buildPrompt(atom, [], { notes: [{ id: 'n1', title: '笔记标题', body: '笔记正文' }] });
  assert.match(p, /相关笔记（得到大脑）/);
  assert.match(p, /笔记标题/);
  assert.match(p, /笔记正文/);
});

test('buildPrompt 无 body / 无 notes 时不产生空段落', () => {
  const p = buildPrompt({ id: 'AT-1', title: '空任务' }, []);
  assert.ok(!p.includes('写作要求\n\n##'), '不该出现空的描述块');
});

test('buildPrompt 注入目标成果', () => {
  const p = buildPrompt({ ...atom, target: '形成一份设计文档' }, []);
  assert.match(p, /## 交付目标/);
  assert.match(p, /形成一份设计文档/);
});

test('buildPrompt 无 target 时不输出目标成果段落', () => {
  const p = buildPrompt({ ...atom, target: '' }, []);
  assert.ok(!p.includes('## 交付目标'));
});

test('parseEventLine 忽略非 JSON 行', () => {
  assert.equal(parseEventLine(''), null);
  assert.equal(parseEventLine('not json'), null);
  assert.deepEqual(parseEventLine('{"a":1}'), { a: 1 }, '合法 JSON 行会被解析，交给上层判断 type');
  assert.deepEqual(parseEventLine('{"type":"thread.started"}'), { type: 'thread.started' });
});

test('summarizeItem 映射 codex 的 item 类型', () => {
  assert.deepEqual(summarizeItem({ type: 'agent_message', text: 'hi' }), { kind: 'message', text: 'hi' });
  assert.equal(summarizeItem({ type: 'command_execution', command: 'ls', exit_code: 0 }).kind, 'command');
  assert.equal(summarizeItem({ type: 'file_change', path: 'a.js' }).kind, 'file');
  assert.equal(summarizeItem({ type: 'todo_list', todos: [] }).kind, 'todo');
  assert.equal(summarizeItem({ type: 'error', message: 'boom' }).kind, 'error');
  assert.equal(summarizeItem({ type: 'unknown_thing' }), null);
  assert.equal(summarizeItem(null), null);
});

test('progressFromTodos 按完成比例换算进度', () => {
  assert.equal(progressFromTodos([]), null);
  assert.equal(progressFromTodos(null), null);
  assert.equal(progressFromTodos([{ status: 'completed' }, { status: 'completed' }]), 90);
  assert.equal(progressFromTodos([{ status: 'completed' }, { status: 'pending' }]), 45);
  assert.equal(progressFromTodos([{ status: 'pending' }]), 0);
});

test('buildCommand 默认走 codex exec --json', () => {
  const cmd = buildCommand([{ type: 'codex', name: 'codex', runner: 'codex' }], 'PROMPT');
  assert.equal(cmd.jsonl, true);
  assert.match(cmd.args.join(' '), /exec --json/);
  assert.equal(cmd.args[cmd.args.length - 1], 'PROMPT');
});

test('buildCommand 传 sandbox 时不追加 --approve-for-me', () => {
  const cmd = buildCommand([{ type: 'codex', name: 'codex', runner: 'codex' }], 'P', { sandbox: 'read-only' });
  assert.ok(cmd.args.includes('--sandbox'));
  assert.ok(cmd.args.includes('read-only'));
  assert.ok(!cmd.args.includes('--approve-for-me'));
});

test('buildCommand 对非 codex 的自定义 agent 直接跑该 CLI 并走 stdin', () => {
  const cmd = buildCommand([{
    type: 'agent', name: 'custom', runner: 'custom',
    agent: { name: 'custom', cmd: 'mytool', args: ['--x'], prompt: '' },
  }], 'PROMPT');
  assert.equal(cmd.cmd, 'mytool');
  assert.equal(cmd.jsonl, false);
  assert.equal(cmd.stdin, 'PROMPT');
  assert.deepEqual(cmd.args, ['--x']);
});

test('resolveCodexBin 返回可执行文件路径', () => {
  const bin = resolveCodexBin();
  assert.ok(bin.cmd, '必须有 cmd');
  assert.ok(Array.isArray(bin.args));
});
