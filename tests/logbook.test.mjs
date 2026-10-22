import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore, createProject, createAtom, addEvent } from '../src/store.mjs';
import { syncLog, writeState, logPaths, writeOntology } from '../src/logbook.mjs';

function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-log-'));
  const db = openStore(root);
  try {
    return fn({ db, root });
  } finally {
    db.close?.();
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
}

function seed(db) {
  const p = createProject(db, { key: 'demo', name: '演示', description: '说明文字' });
  const a = createAtom(db, { projectId: p.id, title: '测试任务', body: '正文', status: 'in_progress', progress: 45 });
  addEvent(db, a.id, 'output', 'codex', '执行输出内容');
  return { p, a };
}

test('syncLog 生成 events.jsonl / LOG.md / STATE.md', () => {
  withRoot(({ db, root }) => {
    const { a } = seed(db);
    const res = syncLog(root, db);
    assert.ok(res.appended > 0);

    const p = logPaths(root);
    assert.ok(existsSync(p.jsonl));
    assert.ok(existsSync(p.md));
    assert.ok(existsSync(p.state));

    const lines = readFileSync(p.jsonl, 'utf8').trim().split('\n');
    const parsed = lines.map(l => JSON.parse(l));
    assert.ok(parsed.some(e => e.atom === a.id && e.type === 'output'));
    assert.ok(parsed.every(e => typeof e.ts === 'string' && 'type' in e));
  });
});

test('events.jsonl 是只追加的：重复 syncLog 不改写旧行', () => {
  withRoot(({ db, root }) => {
    seed(db);
    syncLog(root, db);
    const p = logPaths(root);
    const first = readFileSync(p.jsonl, 'utf8');

    const res = syncLog(root, db);
    assert.equal(res.appended, 0, '没有新事件时不应追加');
    assert.equal(readFileSync(p.jsonl, 'utf8'), first, '旧内容不得被改写');
  });
});

test('syncLog 增量追加新事件到既有 jsonl 之后', () => {
  withRoot(({ db, root }) => {
    const { a } = seed(db);
    syncLog(root, db);
    const p = logPaths(root);
    const before = readFileSync(p.jsonl, 'utf8').trim().split('\n').length;

    addEvent(db, a.id, 'output', 'codex', '第二条输出');
    const res = syncLog(root, db);
    assert.equal(res.appended, 1);

    const after = readFileSync(p.jsonl, 'utf8').trim().split('\n');
    assert.equal(after.length, before + 1);
    assert.equal(JSON.parse(after[after.length - 1]).message, '第二条输出');
  });
});

test('LOG.md 渲染成可读表格', () => {
  withRoot(({ db, root }) => {
    seed(db);
    syncLog(root, db);
    const md = readFileSync(logPaths(root).md, 'utf8');
    assert.match(md, /# W-AtomBoard 全局 Log/);
    assert.match(md, /\| 时间 \| 原子 \| 项目 \| 类型 \| 主体 \| 内容 \|/);
    assert.match(md, /执行输出内容/);
  });
});

test('STATE.md 快照包含项目、原子、状态与进度', () => {
  withRoot(({ db, root }) => {
    const { a } = seed(db);
    writeState(root, db);
    const md = readFileSync(logPaths(root).state, 'utf8');
    assert.match(md, /# W-AtomBoard 当前状态/);
    assert.match(md, /演示/);
    assert.match(md, new RegExp(a.id));
    assert.match(md, /in_progress/);
    assert.match(md, /45%/);
  });
});

test('STATE.md 转义表格里的竖线，避免表格错位', () => {
  withRoot(({ db, root }) => {
    const p = createProject(db, { key: 'demo', name: '演示' });
    createAtom(db, { projectId: p.id, title: '标题|带竖线' });
    writeState(root, db);
    const md = readFileSync(logPaths(root).state, 'utf8');
    assert.match(md, /标题\\\|带竖线/);
  });
});

test('writeOntology 落地本体 JSON 与 Markdown', () => {
  withRoot(({ root }) => {
    const p = writeOntology(root);
    assert.ok(existsSync(p.ontologyJson));
    assert.ok(existsSync(p.ontologyMd));
    const json = JSON.parse(readFileSync(p.ontologyJson, 'utf8'));
    assert.equal(json.name, 'W-AtomBoard');
    assert.ok(json.entities?.length, '本体应含实体定义');
    const md = readFileSync(p.ontologyMd, 'utf8');
    assert.match(md, /W-AtomBoard/);
  });
});
