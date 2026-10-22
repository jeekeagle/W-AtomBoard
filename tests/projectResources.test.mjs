import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore, createProject, createAtom } from '../src/store.mjs';
import { readConfig } from '../src/config.mjs';
import {
  kbNameForProject, getnoteCacheDir, collectLocalResources, collectGetnoteResources,
  getProjectResources, resolveProjectResource,
} from '../src/projectResources.mjs';
import { projectFolder, atomFolder } from '../src/workspaces.mjs';

function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-res-'));
  const db = openStore(root);
  const cfg = readConfig(root);
  cfg.workspaces = { ...cfg.workspaces, baseDir: path.join(root, 'workspaces') };
  try {
    return fn({ root, db, cfg });
  } finally {
    db.close?.();
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
}

test('kbNameForProject 生成 ATOM- 前缀的知识库名', () => {
  assert.equal(kbNameForProject({ name: '智能体设计与应用' }), 'WATOM-智能体设计与应用');
  assert.equal(kbNameForProject({ name: '  Demo  ' }), 'WATOM-Demo');
  assert.equal(kbNameForProject({}), 'WATOM-');
});

test('getnoteCacheDir 落在项目目录的 .watomboard/getnote 下', () => {
  withRoot(({ root, db, cfg }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const dir = getnoteCacheDir(root, p, cfg);
    assert.equal(dir, path.join(projectFolder(root, p, cfg), '.watomboard', 'getnote'));
  });
});

test('collectLocalResources 收集项目下各 Atom 的文件并标注归属', () => {
  withRoot(({ root, db, cfg }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: '写一份文档' });
    const folder = atomFolder(root, a, p, cfg);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'design.md'), '# 设计', 'utf8');

    const local = collectLocalResources(db, root, p, cfg);
    assert.equal(local.length, 1);
    assert.equal(local[0].name, 'design.md');
    assert.equal(local[0].atom_id, a.id);
    assert.equal(local[0].atom_title, '写一份文档');
    assert.ok(!local[0].path.startsWith('.watomboard/'));
  });
});

test('collectGetnoteResources 读取本地快照索引', () => {
  withRoot(({ root, db, cfg }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const cacheDir = getnoteCacheDir(root, p, cfg);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, 'n1-笔记.md'), '# 笔记', 'utf8');
    writeFileSync(path.join(cacheDir, '_index.json'), JSON.stringify({
      documents: [
        { note_id: 'n1', title: '笔记', path: '.watomboard/getnote/n1-笔记.md', updated_at: '2026-01-02T00:00:00.000Z' },
      ],
    }), 'utf8');

    const docs = collectGetnoteResources(root, p, cfg);
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, '笔记');
  });
});

test('getProjectResources 同时返回本地与得到大脑两类资源', () => {
  withRoot(({ root, db, cfg }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: 'T' });
    const folder = atomFolder(root, a, p, cfg);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'a.md'), 'x', 'utf8');

    const res = getProjectResources(db, root, p, cfg);
    assert.equal(res.kb_name, 'WATOM-Demo');
    assert.equal(res.local.length, 1);
    assert.deepEqual(res.getnote, []);
    assert.ok(existsSync(res.folder));
  });
});

test('resolveProjectResource 拒绝越界路径', () => {
  withRoot(({ root, db, cfg }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const folder = projectFolder(root, p, cfg);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'ok.md'), 'x', 'utf8');

    assert.equal(resolveProjectResource(root, p, cfg, 'ok.md'), path.join(folder, 'ok.md'));
    assert.throws(() => resolveProjectResource(root, p, cfg, '../escape.md'), /非法文件路径/);
    assert.throws(() => resolveProjectResource(root, p, cfg, 'missing.md'), /文件不存在/);
  });
});
