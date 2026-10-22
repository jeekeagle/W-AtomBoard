import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMentions, findSkill, listTargets, resolveMention, agentDefinitions, skillMeta } from '../src/mentions.mjs';

test('parseMentions 识别 @codex / @skill:x / @agent:x / 裸技能名', () => {
  const m = parseMentions('请 @codex 和 @skill:w-atomboard 与 @agent:reviewer 处理');
  const byType = Object.fromEntries(m.map(x => [x.name, x.type]));
  assert.equal(byType.codex, 'codex');
  assert.equal(byType['w-atomboard'], 'skill');
  assert.equal(byType.reviewer, 'agent');
});

test('parseMentions 去重且大小写不敏感', () => {
  const m = parseMentions('@codex @Codex @CODEX');
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'codex');
});

test('parseMentions 对空输入返回空数组', () => {
  assert.deepEqual(parseMentions(''), []);
  assert.deepEqual(parseMentions(null), []);
  assert.deepEqual(parseMentions(undefined), []);
  assert.deepEqual(parseMentions('没有提及符'), []);
});

test('parseMentions 保留原始写法 raw', () => {
  const m = parseMentions('@skill:w-atomboard');
  assert.equal(m[0].raw, '@skill:w-atomboard');
  assert.equal(m[0].name, 'w-atomboard');
});

test('项目内 skills/ 目录可被 findSkill 找到', () => {
  const root = process.cwd();
  const skill = findSkill('w-atomboard');
  assert.ok(skill, '应能找到 skills/w-atomboard');
  assert.ok(skill.file.endsWith(path.join('skills', 'w-atomboard', 'SKILL.md')));
});

test('skillMeta 解析 front matter 的 name 与 description', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-skill-'));
  try {
    const dir = path.join(root, 'skills', 'demo-skill');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'SKILL.md');
    writeFileSync(file, '---\nname: demo-skill\ndescription: 一个演示技能\n---\n\n正文内容\n', 'utf8');
    const meta = skillMeta(file);
    assert.equal(meta.name, 'demo-skill');
    assert.equal(meta.description, '一个演示技能');
    assert.match(meta.body, /正文内容/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
});

test('listTargets 至少包含 codex 与项目内技能', () => {
  const targets = listTargets(process.cwd());
  const names = targets.map(t => t.name);
  assert.ok(names.includes('codex'), 'codex 必须是默认可用目标');
  assert.ok(names.includes('w-atomboard'), '项目内技能应被列出');
  assert.equal(targets.find(t => t.name === 'codex').type, 'codex');
});

test('resolveMention：@codex 走 codex 执行体', () => {
  const r = resolveMention(process.cwd(), { type: 'codex', name: 'codex' });
  assert.equal(r.runner, 'codex');
  assert.equal(r.missing, undefined);
});

test('resolveMention：@skill:w-atomboard 解析出 skill 文件', () => {
  const r = resolveMention(process.cwd(), { type: 'skill', name: 'w-atomboard' });
  assert.equal(r.type, 'skill');
  assert.ok(r.skillFile && r.skillFile.endsWith('SKILL.md'));
  assert.notEqual(r.missing, true);
});

test('resolveMention：找不到的执行目标标记 missing', () => {
  const r = resolveMention(process.cwd(), { type: 'skill', name: '绝对不存在的技能-xyz' });
  assert.equal(r.missing, true);
  assert.equal(r.runner, 'codex');
});

test('agentDefinitions 优先读当前工作目录的 agents.json', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-agent-'));
  const cwd = process.cwd();
  try {
    writeFileSync(path.join(root, 'agents.json'), JSON.stringify([
      { name: 'from-root', cmd: 'echo' },
    ]), 'utf8');
    // 当前工作目录里已有真实 agents.json，优先级高于 root
    const { list } = agentDefinitions(root);
    assert.ok(list.length >= 1);
    assert.equal(list[0].name, 'editor', '项目 agents.json 里的 editor 应排在最前');
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
});

test('agentDefinitions 在工作目录无 agents.json 时回落到 root', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-agent-'));
  const cwd = process.cwd();
  const empty = mkdtempSync(path.join(tmpdir(), 'atomboard-cwd-'));
  try {
    writeFileSync(path.join(root, 'agents.json'), JSON.stringify([
      { name: 'from-root', cmd: 'echo' },
    ]), 'utf8');
    process.chdir(empty);
    const { list, file } = agentDefinitions(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'from-root');
    assert.ok(file.endsWith('agents.json'));
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    rmSync(empty, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
});

test('agentDefinitions 对损坏的 JSON 返回空列表而不抛错', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-agent-'));
  const cwd = process.cwd();
  const empty = mkdtempSync(path.join(tmpdir(), 'atomboard-cwd-'));
  try {
    writeFileSync(path.join(root, 'agents.json'), '{ 这不是合法 JSON', 'utf8');
    process.chdir(empty);
    const { list } = agentDefinitions(root);
    assert.deepEqual(list, [], '坏 JSON 应被忽略而不是抛错');
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    rmSync(empty, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
});
