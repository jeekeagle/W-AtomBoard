import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();

/**
 * 把整个项目复制到临时目录后再跑 CLI —— 端到端跑真实命令，
 * 但绝不触碰真实仓库的 data/watomboard.db 与 data/config.json。
 */
function withSandbox(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-e2e-'));
  try {
    for (const d of ['bin', 'src', 'ontology', 'styles', 'skills', 'web']) {
      cpSync(path.join(REPO, d), path.join(root, d), { recursive: true });
    }
    cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'));
    // 清掉递归保护相关环境变量：本测试就是从执行体内部跑的
    // 测试内显式关闭自动执行：拖动状态不应真的拉起 Codex（否则临时目录会被后台进程占用）
    const env = { ...process.env, NO_COLOR: '1', ATOMBOARD_AUTORUN: '0' };
    delete env.ATOMBOARD_DEPTH;
    delete env.ATOMBOARD_ATOM;
    delete env.ATOMBOARD_ROOT;
    return fn({ root, cli: (...args) => execFileSync(process.execPath, [path.join(root, 'bin', 'watomboard.mjs'), ...args], { cwd: root, encoding: 'utf8', env }) });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
}

test('E2E：建项目 → 建原子 → 推进状态 → 日志落盘', () => {
  withSandbox(({ root, cli }) => {
    cli('project', 'add', '演示项目', '--desc', '端到端测试', '--key', 'demo');
    cli('atom', 'new', 'demo', '--title', '写一份测试', '--body', '验证 CLI 全链路', '--mention', '@codex');

    const list = cli('atom', 'list', '--project', 'demo');
    assert.match(list, /AT-1/);
    assert.match(list, /写一份测试/);

    const show = cli('atom', 'show', 'AT-1');
    assert.match(show, /AT-1/);
    assert.match(show, /验证 CLI 全链路/);

    cli('atom', 'move', 'AT-1', 'in_progress');
    const after = cli('atom', 'show', 'AT-1');
    assert.match(after, /写作中/);

    assert.ok(existsSync(path.join(root, 'data', 'watomboard.db')), '沙箱里应生成数据库');
    const jsonl = readFileSync(path.join(root, 'logs', 'events.jsonl'), 'utf8');
    assert.match(jsonl, /"atom":"AT-1"/);
    assert.match(jsonl, /"type":"status"/);
  });
});

test('E2E：--dry-run 只打印 prompt，不真的执行', () => {
  withSandbox(({ cli }) => {
    cli('project', 'add', '演示项目', '--key', 'demo');
    cli('atom', 'new', 'demo', '--title', '只预览', '--body', '不执行', '--mention', '@codex');
    const out = cli('atom', 'run', 'AT-1', '--dry-run');
    assert.match(out, /--- prompt ---/);
    assert.match(out, /执行边界/);
  });
});

test('E2E：原子状态不被 dry-run 改变', () => {
  withSandbox(({ root, cli }) => {
    cli('project', 'add', '演示项目', '--key', 'demo');
    cli('atom', 'new', 'demo', '--title', '只预览', '--mention', '@codex');
    cli('atom', 'run', 'AT-1', '--dry-run');
    const show = cli('atom', 'show', 'AT-1');
    assert.match(show, /待写/);
    assert.ok(!/写作中/.test(show));
  });
});

test('E2E：atom log 记录的事件进入 jsonl', () => {
  withSandbox(({ root, cli }) => {
    cli('project', 'add', '演示项目', '--key', 'demo');
    cli('atom', 'new', 'demo', '--title', 'T');
    cli('atom', 'log', 'AT-1', '这是一条人工备注');
    const jsonl = readFileSync(path.join(root, 'logs', 'events.jsonl'), 'utf8');
    assert.match(jsonl, /这是一条人工备注/);
  });
});

test('E2E：找不到项目时报错并返回非零退出码', () => {
  withSandbox(({ root, cli }) => {
    let failed = false;
    try {
      cli('atom', 'new', '不存在', '--title', 'X');
    } catch (e) {
      failed = true;
      assert.match(String(e.stderr), /找不到项目/);
      assert.notEqual(e.status, 0);
    }
    assert.ok(failed, '应当以非零退出码失败');
  });
});

test('E2E：state / board 命令可运行', () => {
  withSandbox(({ cli }) => {
    cli('project', 'add', '演示项目', '--key', 'demo');
    cli('atom', 'new', 'demo', '--title', 'T');
    assert.match(cli('state'), /W-AtomBoard 当前状态/);
    assert.match(cli('board'), /演示项目/);
  });
});
