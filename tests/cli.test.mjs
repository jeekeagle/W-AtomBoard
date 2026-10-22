import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.mjs';

test('parseArgs 拆位置参数与长标志', () => {
  const { positional, flags } = parseArgs(['atom', 'new', 'demo', '--title', '写测试', '--body', '正文']);
  assert.deepEqual(positional, ['atom', 'new', 'demo']);
  assert.equal(flags.title, '写测试');
  assert.equal(flags.body, '正文');
});

test('parseArgs 支持 --key=value 写法', () => {
  const { flags } = parseArgs(['--key=my-project', '--title=带=号的标题']);
  assert.equal(flags.key, 'my-project');
  assert.equal(flags.title, '带=号的标题');
});

test('parseArgs 无值的布尔标志为 true', () => {
  const { flags } = parseArgs(['atom', 'run', 'AT-1', '--background']);
  assert.equal(flags.background, true);
});

test('parseArgs 布尔标志后跟位置参数时不算作它的值', () => {
  const { positional, flags } = parseArgs(['--dry-run', 'atom', 'show']);
  assert.equal(flags['dry-run'], true);
  assert.deepEqual(positional, ['atom', 'show']);
});

test('parseArgs 支持短横线单字母标志', () => {
  const { positional, flags } = parseArgs(['atom', 'list', '-p', 'demo']);
  assert.deepEqual(positional, ['atom', 'list']);
  assert.equal(flags.p, 'demo');
});

test('parseArgs 空输入返回空结构', () => {
  assert.deepEqual(parseArgs([]), { positional: [], flags: {} });
});
