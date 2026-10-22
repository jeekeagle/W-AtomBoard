import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, readConfig, saveConfig, configPaths, resolveCodex } from '../src/config.mjs';

function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-config-'));
  try { return fn({ root }); }
  finally { rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 }); }
}

test('readConfig 无任何配置文件时返回默认配置', () => {
  withRoot(({ root }) => {
    const cfg = readConfig(root);
    // 默认值来自 DEFAULT_CONFIG，不硬编码字面量（避免默认值演进后测试假失败）
    assert.equal(cfg.codex.sandbox, DEFAULT_CONFIG.codex.sandbox);
    assert.equal(cfg.codex.timeoutSec, DEFAULT_CONFIG.codex.timeoutSec);
    assert.equal(cfg.server.port, DEFAULT_CONFIG.server.port);
    assert.equal(cfg.server.host, DEFAULT_CONFIG.server.host);
  });
});

test('readConfig 把默认值、本地、全局三层合并起来', () => {
  withRoot(({ root }) => {
    const p = configPaths(root);
    mkdirSync(path.dirname(p.local), { recursive: true });
    writeFileSync(p.local, JSON.stringify({ server: { port: 9999 } }), 'utf8');
    const cfg = readConfig(root);
    assert.equal(cfg.server.port, 9999, '本地应覆盖默认');
    assert.equal(cfg.server.host, DEFAULT_CONFIG.server.host, '未覆盖的字段回落默认');
    assert.equal(cfg.codex.sandbox, DEFAULT_CONFIG.codex.sandbox);
  });
});

test('saveConfig 局部写入并可读回，且不影响其他字段', () => {
  withRoot(({ root }) => {
    saveConfig(root, { codex: { model: 'gpt-5' } });
    assert.ok(existsSync(configPaths(root).local));
    const cfg = readConfig(root);
    assert.equal(cfg.codex.model, 'gpt-5');
    assert.equal(cfg.codex.sandbox, 'approve-for-me', '未给的字段由默认值补齐');
  });
});

test('saveConfig 二次写入会与已有内容深合并', () => {
  withRoot(({ root }) => {
    saveConfig(root, { codex: { model: 'gpt-5' } });
    saveConfig(root, { codex: { sandbox: 'read-only' } });
    const cfg = readConfig(root);
    assert.equal(cfg.codex.model, 'gpt-5', '先前的 model 不应被覆盖');
    assert.equal(cfg.codex.sandbox, 'read-only');
  });
});

test('DEFAULT_CONFIG 不被 saveConfig 就地污染', () => {
  withRoot(({ root }) => {
    const before = JSON.stringify(DEFAULT_CONFIG);
    saveConfig(root, { codex: { model: 'x' }, server: { port: 1 } });
    assert.equal(JSON.stringify(DEFAULT_CONFIG), before, '默认配置必须是只读基线');
  });
});

test('resolveCodex 优先使用显式配置的二进制', () => {
  withRoot(({ root }) => {
    const fake = path.join(root, 'codex.exe');
    writeFileSync(fake, 'stub', 'utf8');
    const r = resolveCodex({ codex: { bin: fake } });
    assert.equal(r.cmd, fake);
    assert.equal(r.source, 'config');
  });
});

test('resolveCodex 在没有配置时回落到 PATH', () => {
  const r = resolveCodex({});
  assert.ok(r.cmd);
  assert.ok(['desktop', 'path'].includes(r.source), `意外来源：${r.source}`);
});
