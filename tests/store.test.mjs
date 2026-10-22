import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openStore, slugifyKey, uniqueKey, createProject, getProject, getProjectByKey,
  listProjects, createAtom, getAtom, listAtoms, updateAtom, deleteAtom,
  addEvent, listEvents, lastEventId, addLink, listLinks, removeLink, updateProject,
} from '../src/store.mjs';

/** 每个用例一个临时 root，绝不碰真实 data/watomboard.db */
function withStore(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-test-'));
  const db = openStore(root);
  try {
    return fn({ db, root });
  } finally {
    db.close?.();
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
}

test('slugifyKey 生成 ASCII 小写连字符 key', () => {
  assert.equal(slugifyKey('我的项目'), 'project', '纯中文降级为 project');
  assert.equal(slugifyKey('My Project'), 'my-project');
  assert.equal(slugifyKey('  Hello  World  '), 'hello-world');
  assert.equal(slugifyKey('a_b.c/d'), 'a-b-c-d');
  assert.equal(slugifyKey(''), 'project');
});

test('uniqueKey 在冲突时追加 -2 -3', () => {
  withStore(({ db }) => {
    createProject(db, { key: 'demo', name: 'Demo' });
    const k2 = uniqueKey(db, 'demo');
    assert.equal(k2, 'demo-2');
    createProject(db, { key: k2, name: 'Demo 2' });
    assert.equal(uniqueKey(db, 'demo'), 'demo-3');
  });
});

test('createProject 落库并可按 key / id 取回', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: '演示项目', description: '说明' });
    assert.equal(p.key, 'demo');
    assert.equal(p.name, '演示项目');
    assert.equal(p.status, 'active');
    assert.equal(getProjectByKey(db, 'demo').id, p.id);
    assert.equal(getProject(db, p.id).key, 'demo');
  });
});

test('createProject 自动 slugify 非 ASCII 名称', () => {
  withStore(({ db }) => {
    const p = createProject(db, { name: '得到大脑打通' });
    assert.match(p.key, /^[a-z0-9-]+$/, `key 必须是 ASCII：${p.key}`);
    assert.equal(p.name, '得到大脑打通');
  });
});

test('listProjects 统计 atom 数与未完成数', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    createAtom(db, { projectId: p.id, title: 'A', status: 'todo' });
    createAtom(db, { projectId: p.id, title: 'B', status: 'done' });
    const row = listProjects(db).find(x => x.key === 'demo');
    assert.equal(row.atom_count, 2);
    assert.equal(row.open_count, 1, 'done 不计入未完成');
  });
});

test('createAtom 分配 AT-N 序号并写 created 事件', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: '写测试', body: '描述', mentions: [{ type: 'codex', name: 'codex', raw: '@codex' }] });
    assert.equal(a.id, 'AT-1');
    assert.equal(a.seq, 1);
    assert.equal(a.status, 'todo');
    assert.equal(a.progress, 0);
    assert.deepEqual(a.mentions, [{ type: 'codex', name: 'codex', raw: '@codex' }]);
    const evs = listEvents(db, 'AT-1');
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, 'created');
  });
});

test('Atom 序号跨项目连续递增', () => {
  withStore(({ db }) => {
    const p1 = createProject(db, { key: 'a', name: 'A' });
    const p2 = createProject(db, { key: 'b', name: 'B' });
    assert.equal(createAtom(db, { projectId: p1.id, title: 'x' }).id, 'AT-1');
    assert.equal(createAtom(db, { projectId: p2.id, title: 'y' }).id, 'AT-2');
    assert.equal(createAtom(db, { projectId: p1.id, title: 'z' }).id, 'AT-3');
  });
});

test('createAtom 保存目标，updateAtom 可修改目标', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, {
      projectId: p.id,
      title: '写文档',
      target: '形成一份设计文档',
    });
    assert.equal(a.target, '形成一份设计文档');
    assert.equal(getAtom(db, a.id).target, '形成一份设计文档');

    const updated = updateAtom(db, a.id, { target: '形成一份可评审的设计文档' });
    assert.equal(updated.target, '形成一份可评审的设计文档');
    assert.equal(getAtom(db, a.id).target, '形成一份可评审的设计文档');
  });
});

test('listAtoms 支持按项目与状态过滤', () => {
  withStore(({ db }) => {
    const p1 = createProject(db, { key: 'a', name: 'A' });
    const p2 = createProject(db, { key: 'b', name: 'B' });
    createAtom(db, { projectId: p1.id, title: 'a1', status: 'todo' });
    createAtom(db, { projectId: p1.id, title: 'a2', status: 'done' });
    createAtom(db, { projectId: p2.id, title: 'b1', status: 'todo' });

    assert.equal(listAtoms(db, { project: 'a' }).length, 2);
    assert.equal(listAtoms(db, { project: 'b' }).length, 1);
    assert.equal(listAtoms(db, { status: 'todo' }).length, 2);
    assert.equal(listAtoms(db, { status: 'todo,done' }).length, 3);
    assert.equal(listAtoms(db, { project: 'nope' }).length, 0, '不存在的项目返回空');
  });
});

test('updateAtom 只改白名单字段，空 patch 不写入', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: 'T' });
    const updated = updateAtom(db, a.id, { status: 'in_progress', progress: 45, title: 'T2' });
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.progress, 45);
    assert.equal(updated.title, 'T2');

    const before = updated.updated_at;
    const again = updateAtom(db, a.id, {});
    assert.equal(again.updated_at, before, '空 patch 不应改动 updated_at');
    assert.equal(again.status, 'in_progress');
  });
});

test('updateAtom 忽略白名单之外的字段', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: 'T' });
    const updated = updateAtom(db, a.id, { id: 'HACKED', project_id: 999, seq: 999 });
    assert.equal(updated.id, a.id, '主键不可改');
    assert.equal(updated.project_id, p.id, '所属项目不可改');
    assert.equal(updated.seq, a.seq, '序号不可改');
  });
});

test('删除 Atom 时级联删除其事件与链接', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: 'T' });
    addEvent(db, a.id, 'note', 'user', 'hello');
    addLink(db, a.id, 'getnote', 'n-123', '某笔记');
    assert.equal(listLinks(db, a.id).length, 1);

    deleteAtom(db, a.id);
    assert.equal(getAtom(db, a.id), null);
    assert.equal(listEvents(db, a.id).length, 0);
    assert.equal(listLinks(db, a.id).length, 0);
  });
});

test('事件是只追加的，lastEventId 单调增长', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: 'T' });
    const first = lastEventId(db, a.id);
    addEvent(db, a.id, 'output', 'codex', '第一段输出');
    addEvent(db, a.id, 'output', 'codex', '第二段输出');
    const last = lastEventId(db, a.id);
    assert.ok(last > first);
    const evs = listEvents(db, a.id);
    assert.deepEqual(evs.slice(-2).map(e => e.message), ['第一段输出', '第二段输出']);
    assert.equal(evs[0].type, 'created');
  });
});

test('listEvents 支持 after 增量拉取', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: 'T' });
    const after = lastEventId(db, a.id);
    addEvent(db, a.id, 'output', 'codex', '新事件');
    const inc = listEvents(db, a.id, { after });
    assert.equal(inc.length, 1);
    assert.equal(inc[0].message, '新事件');
  });
});

test('links 唯一约束：重复添加不产生重复行', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: 'T' });
    addLink(db, a.id, 'getnote', 'n-1', '标题一');
    addLink(db, a.id, 'getnote', 'n-1', '标题一（重复）');
    assert.equal(listLinks(db, a.id).length, 1);
    addLink(db, a.id, 'url', 'https://example.com', '链接');
    assert.equal(listLinks(db, a.id).length, 2);
    assert.equal(removeLink(db, a.id, 'getnote', 'n-1'), 1);
    assert.equal(removeLink(db, a.id, 'getnote', 'n-1'), 0, '重复移除返回 0');
  });
});

test('损坏的 mentions JSON 不会让读取崩溃', () => {
  withStore(({ db }) => {
    const p = createProject(db, { key: 'demo', name: 'Demo' });
    const a = createAtom(db, { projectId: p.id, title: 'T' });
    db.prepare('UPDATE atoms SET mentions = ? WHERE id = ?').run('{坏掉的 JSON', a.id);
    assert.deepEqual(getAtom(db, a.id).mentions, []);
  });
});
