import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();

function withSandbox(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-e2e-'));
  try {
    for (const d of ['bin', 'src', 'ontology', 'styles', 'skills', 'web']) {
      cpSync(path.join(REPO, d), path.join(root, d), { recursive: true });
    }
    cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'));

    // 假的执行体：吐 codex exec --json 的 JSONL
    const fake = path.join(root, 'fake-codex.mjs');
    writeFileSync(fake, [
      "process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 't-9' }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '执行体说：完成' } }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');",
    ].join('\n'), 'utf8');

    const base = { ...process.env, NO_COLOR: '1', ATOMBOARD_AUTORUN: '0' };
    delete base.ATOMBOARD_DEPTH;
    delete base.ATOMBOARD_ATOM;
    delete base.ATOMBOARD_ROOT;
    const cli = (args, env) => execFileSync(
      process.execPath,
      [path.join(root, 'bin', 'watomboard.mjs'), ...args],
      { cwd: root, encoding: 'utf8', env: { ...base, ...(env || {}) } },
    );
    return fn({ root, cli, fake });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
}

test('E2E：真实执行把执行体输出记成 output 事件并进入待验收', () => {
  withSandbox(({ cli, fake }) => {
    cli(['project', 'add', '演示', '--key', 'demo']);
    cli(['atom', 'new', 'demo', '--title', 'T', '--mention', '@codex']);

    const out = cli(['atom', 'run', 'AT-1'], {
      ATOMBOARD_CODEX_BIN: process.execPath,
      ATOMBOARD_CODEX_ARGS: JSON.stringify([fake]),
    });
    assert.match(out, /执行体说：完成/);
    assert.match(out, /待验收/, '执行成功后应进入待验收');
  });
});

test('E2E：执行结束后 jsonl 里有 output 事件与 thread id', () => {
  withSandbox(({ root, cli, fake }) => {
    cli(['project', 'add', '演示', '--key', 'demo']);
    cli(['atom', 'new', 'demo', '--title', 'T', '--mention', '@codex']);
    cli(['atom', 'run', 'AT-1'], {
      ATOMBOARD_CODEX_BIN: process.execPath,
      ATOMBOARD_CODEX_ARGS: JSON.stringify([fake]),
    });

    const jsonl = readFileSync(path.join(root, 'logs', 'events.jsonl'), 'utf8');
    assert.match(jsonl, /"type":"output"/);
    assert.match(jsonl, /执行体说：完成/);
    assert.match(jsonl, /"type":"run_end"/);
  });
});

test('E2E：执行体非零退出时原子转入受阻', () => {
  withSandbox(({ root, cli }) => {
    const bad = path.join(root, 'bad-codex.mjs');
    writeFileSync(bad, "process.stderr.write('炸了'); process.exit(3);", 'utf8');

    cli(['project', 'add', '演示', '--key', 'demo']);
    cli(['atom', 'new', 'demo', '--title', 'T', '--mention', '@codex']);

    let failed = false;
    try {
      cli(['atom', 'run', 'AT-1'], {
        ATOMBOARD_CODEX_BIN: process.execPath,
        ATOMBOARD_CODEX_ARGS: JSON.stringify([bad]),
      });
    } catch { failed = true; }
    assert.ok(failed, '非零退出应让 CLI 返回非零');

    const show = cli(['atom', 'show', 'AT-1']);
    assert.match(show, /卡文/);
  });
});
