import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONTOLOGY, ontologyJSON, ontologyMarkdown } from '../src/ontology.mjs';

test('本体包含核心实体与状态机', () => {
  const names = ONTOLOGY.entities.map(e => e.name);
  for (const n of ['Project', 'Atom', 'Event', 'Link']) {
    assert.ok(names.includes(n), `本体缺少实体 ${n}`);
  }
  assert.ok(ONTOLOGY.stateMachine, '本体应声明状态机');
});

test('本体 JSON 可序列化且结构完整', () => {
  const raw = ontologyJSON();
  assert.equal(typeof raw, 'string', 'ontologyJSON 返回 JSON 文本');
  const j = JSON.parse(raw);
  assert.equal(j.name, 'W-AtomBoard');
  assert.ok(Array.isArray(j.entities));
  assert.ok(j.entities.length >= 4);
  assert.ok(typeof j.version === 'string');
  assert.ok(j.stateMachine, 'JSON 里应含状态机');
});

test('本体 Markdown 渲染出标题与关键小节', () => {
  const md = ontologyMarkdown();
  assert.match(md, /W-AtomBoard/);
  assert.match(md, /#/);
  assert.ok(md.length > 500, '本体文档不应过短');
});

test('磁盘上的本体文件与代码生成物保持同步', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const jsonPath = path.join(process.cwd(), 'ontology', 'watomboard.json');
  const onDisk = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const fresh = JSON.parse(ontologyJSON());
  assert.equal(onDisk.name, fresh.name);
  assert.equal(onDisk.version, fresh.version);
  assert.equal(onDisk.entities.length, fresh.entities.length);
});
