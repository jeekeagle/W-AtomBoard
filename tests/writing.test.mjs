import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  countWords, collectDraftFiles, buildManuscript, exportManuscript, pickManuscriptFile,
} from '../src/writing.mjs';
import { openStore, createProject, createAtom } from '../src/store.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'watom-writing-'));
}

function withStore(fn) {
  const root = tmpdir();
  const db = openStore(root);
  try {
    return fn({ db, root });
  } finally {
    db.close?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function seedProject(db, project, chapters) {
  for (const chapter of chapters) {
    const atom = createAtom(db, {
      projectId: project.id,
      title: chapter.title,
      body: '',
      wordGoal: chapter.wordGoal || 0,
    });
    fs.mkdirSync(chapter.folder, { recursive: true });
    fs.writeFileSync(path.join(chapter.folder, 'draft.md'), chapter.body, 'utf8');
    db.prepare('UPDATE atoms SET folder = ? WHERE id = ?').run(chapter.folder, atom.id);
  }
}

test('countWords 中文按字、英文按词', () => {
  assert.equal(countWords('你好世界'), 4);
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords('中文 hello world 123'), 5);
});

test('countWords 剔除代码块、链接地址与 HTML 标签', () => {
  assert.equal(countWords('```js\nconst a = 1;\n```'), 0);
  assert.equal(countWords('[链接](https://example.com/a/b)'), 2);
  assert.equal(countWords('<div class="x">正文</div>'), 2);
});

test('countWords 对空输入返回 0', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords(null), 0);
  assert.equal(countWords(undefined), 0);
});

test('collectDraftFiles 汇总正文并排除素材目录', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, 'draft.md'), '# 第一章\n\n正文内容。', 'utf8');
  fs.mkdirSync(path.join(root, '素材'), { recursive: true });
  fs.writeFileSync(path.join(root, '素材', '参考.md'), '这是素材不计入字数', 'utf8');
  const r = collectDraftFiles(root);
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].path, 'draft.md');
  assert.equal(r.words, countWords('# 第一章\n\n正文内容。'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('collectDraftFiles 对不存在的目录返回空结果', () => {
  const r = collectDraftFiles(path.join(os.tmpdir(), 'watom-not-exist-xyz'));
  assert.equal(r.words, 0);
  assert.deepEqual(r.files, []);
});

test('pickManuscriptFile 优先 draft.md', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, 'draft.md'), '正文', 'utf8');
  fs.writeFileSync(path.join(root, 'other.md'), '更长的正文内容在这里', 'utf8');
  assert.equal(pickManuscriptFile(root), path.join(root, 'draft.md'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('buildManuscript 按 seq 拼接章节标题', () => {
  withStore(({ db, root }) => {
    const project = createProject(db, { key: 'demo', name: '演示书' });
    seedProject(db, project, [
      { title: '第一章', body: '第一章的正文', folder: path.join(root, 'a1') },
      { title: '第二章', body: '第二章的正文', folder: path.join(root, 'a2') },
    ]);
    const built = buildManuscript(db, root, project, null, {});
    assert.equal(built.chapters.length, 2);
    assert.match(built.markdown, /## 01　第一章/);
    assert.match(built.markdown, /## 02　第二章/);
    assert.ok(built.markdown.indexOf('第一章的正文') < built.markdown.indexOf('第二章的正文'));
  });
});

test('buildManuscript 支持按状态筛选章节', () => {
  withStore(({ db, root }) => {
    const project = createProject(db, { key: 'demo', name: '演示书' });
    seedProject(db, project, [
      { title: '待写章', body: '还没写完', folder: path.join(root, 'a1') },
      { title: '定稿章', body: '已经定稿', folder: path.join(root, 'a2') },
    ]);
    db.prepare("UPDATE atoms SET status = 'done' WHERE title = '定稿章'").run();
    const built = buildManuscript(db, root, project, null, { onlyStatuses: ['done'] });
    assert.deepEqual(built.chapters.map(c => c.title), ['定稿章']);
  });
});

test('exportManuscript 生成 全书稿-YYYY-MM-DD.md', () => {
  withStore(({ db, root }) => {
    const project = createProject(db, { key: 'demo', name: '演示书' });
    seedProject(db, project, [
      { title: '第一章', body: '第一章的正文', folder: path.join(root, 'a1') },
    ]);
    const r = exportManuscript(db, root, project, null, {});
    assert.match(r.rel, /^manuscript\/全书稿-\d{4}-\d{2}-\d{2}\.md$/);
    assert.ok(fs.existsSync(r.file));
    assert.match(fs.readFileSync(r.file, 'utf8'), /# 演示书/);
  });
});
