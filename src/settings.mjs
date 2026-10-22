import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULTS = { style: 'editorial', theme: 'white' };

export function settingsPath(root) {
  return path.join(root, 'data', 'settings.json');
}

export function readSettings(root) {
  const file = settingsPath(root);
  let saved = {};
  if (existsSync(file)) {
    try { saved = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { saved = {}; }
  }
  return { ...DEFAULTS, ...saved };
}

export function writeSettings(root, patch = {}) {
  const next = { ...readSettings(root), ...patch };
  const dir = path.join(root, 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath(root), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function readRegistry(root) {
  const file = path.join(root, 'styles', 'registry.json');
  const fallback = { defaultStyle: 'editorial', defaultTheme: 'white', styles: [], themes: [] };
  if (!existsSync(file)) return fallback;
  try { return { ...fallback, ...JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }; }
  catch { return fallback; }
}

/** 合并注册表与本地设置，得到生效的 style/theme */
export function effectiveStyle(root) {
  const registry = readRegistry(root);
  const settings = readSettings(root);
  const theme = registry.themes.some(t => t.slug === settings.theme) ? settings.theme : (registry.defaultTheme || 'white');
  return { ...registry, defaultTheme: theme, theme, style: settings.style || registry.defaultStyle };
}
