import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSettings, writeSettings, readRegistry, effectiveStyle, settingsPath } from '../src/settings.mjs';

function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'atomboard-settings-'));
  try { return fn({ root }); }
  finally { rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 }); }
}

test('readSettings 无文件时返回默认值', () => {
  withRoot(({ root }) => {
    const s = readSettings(root);
    assert.equal(s.style, 'editorial');
    assert.equal(s.theme, 'white');
  });
});

test('writeSettings 落盘并能被读回', () => {
  withRoot(({ root }) => {
    const next = writeSettings(root, { theme: 'ink' });
    assert.equal(next.theme, 'ink');
    assert.equal(next.style, 'editorial', '未指定的字段保持原值');
    assert.ok(readFileSync(settingsPath(root), 'utf8').includes('ink'));
    assert.equal(readSettings(root).theme, 'ink');
  });
});

test('readRegistry 在注册表缺失时返回兜底结构', () => {
  withRoot(({ root }) => {
    const r = readRegistry(root);
    assert.equal(r.defaultStyle, 'editorial');
    assert.deepEqual(r.styles, []);
    assert.deepEqual(r.themes, []);
  });
});

test('effectiveStyle 以注册表为准，未知主题回落到默认主题', () => {
  withRoot(({ root }) => {
    mkdirSync(path.join(root, 'styles'), { recursive: true });
    writeFileSync(path.join(root, 'styles', 'registry.json'), JSON.stringify({
      defaultStyle: 'editorial', defaultTheme: 'cream',
      styles: [{ slug: 'editorial' }],
      themes: [{ slug: 'cream' }, { slug: 'white' }],
    }), 'utf8');

    writeSettings(root, { style: 'editorial', theme: 'white' });
    let eff = effectiveStyle(root);
    assert.equal(eff.style, 'editorial');
    assert.equal(eff.theme, 'white');

    writeSettings(root, { theme: '不存在的主题' });
    eff = effectiveStyle(root);
    assert.equal(eff.theme, 'cream', '未知主题应回落到 defaultTheme');
  });
});

test('readSettings 对损坏的 JSON 不抛错', () => {
  withRoot(({ root }) => {
    mkdirSync(path.join(root, 'data'), { recursive: true });
    writeFileSync(settingsPath(root), '{ 坏掉的 JSON', 'utf8');
    assert.equal(readSettings(root).style, 'editorial');
  });
});
