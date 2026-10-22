import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { BRAND } from './brand.mjs';

export const DEFAULT_CONFIG = {
  codex: {
    bin: null,                    // null = 自动定位桌面版 codex.exe
    model: null,                  // 覆盖模型（留空则用 ~/.codex/config.toml）
    sandbox: 'approve-for-me',    // approve-for-me | read-only | workspace-write | danger-full-access
    timeoutSec: 900,
    extraArgs: [],
  },
  server: { port: BRAND.defaultPort, host: '127.0.0.1' },
  getnote: { bin: null, kb: null },
  board: { defaultProject: null },
  workspaces: { baseDir: null },   // null = <项目根>/workspaces
};

const HOME = os.homedir();

export function configPaths(root) {
  return {
    global: path.join(HOME, BRAND.globalDir, 'config.json'),
    local: path.join(root, 'data', 'config.json'),
  };
}

function readJson(p) {
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; }
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object')
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/** 读取生效配置：默认 ← 全局 ← 本地 */
export function readConfig(root) {
  const p = configPaths(root);
  let cfg = { ...DEFAULT_CONFIG };
  cfg = deepMerge(cfg, readJson(p.global));
  cfg = deepMerge(cfg, readJson(p.local));
  return cfg;
}

export function saveConfig(root, patch, { scope = 'local' } = {}) {
  const p = configPaths(root);
  const file = scope === 'global' ? p.global : p.local;
  const current = readJson(file);
  const next = deepMerge(current, patch);
  if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** 定位 codex 可执行文件：显式配置 > 桌面版内置 > PATH */
export function resolveCodex(cfg = {}) {
  const bin = cfg.bin || cfg.codex?.bin;
  if (bin && existsSync(bin)) return { cmd: bin, args: [], shell: false, source: 'config' };

  const base = path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  if (existsSync(base)) {
    const dirs = readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(base, d.name))
      .filter(d => existsSync(path.join(d, 'codex.exe')));
    if (dirs.length) return { cmd: path.join(dirs[0], 'codex.exe'), args: [], shell: false, source: 'desktop' };
  }
  return { cmd: 'codex', args: [], shell: process.platform === 'win32', source: 'path' };
}

function run(cmd, args, { timeout = 20000, cwd } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    const t = setTimeout(() => { try { child.kill(); } catch {} }, timeout);
    child.on('error', e => { clearTimeout(t); resolve({ code: -1, stdout: '', stderr: e.message }); });
    child.on('close', code => { clearTimeout(t); resolve({ code, stdout: out, stderr: err }); });
  });
}

/**
 * 测试本地 Codex 连接。
 * light：只查二进制与版本；deep：真的跑一次最小 exec（会调用一次模型）。
 */
export async function testConnection(root, { deep = true } = {}) {
  const cfg = readConfig(root);
  const started = Date.now();
  const result = {
    ok: false,
    codex: { path: null, version: null, source: null, error: null },
    probe: null,
    getnote: { ok: false, version: null, error: null },
    durationMs: 0,
  };

  const bin = resolveCodex(cfg);
  result.codex.path = bin.cmd;
  result.codex.source = bin.source;

  const ver = await run(bin.cmd, [...bin.args, '--version'], { timeout: 20000 });
  if (ver.code === 0) {
    result.codex.version = (ver.stdout || ver.stderr).trim().split('\n')[0];
  } else {
    result.codex.error = (ver.stderr || ver.stdout).trim().slice(0, 300) || `退出码 ${ver.code}`;
  }

  // getnote 连通性
  try {
    const { getnoteJson } = await import('./getnote.mjs');
    const notes = await getnoteJson(['search', 'W-AtomBoard', '--limit', '1']);
    result.getnote.ok = true;
    result.getnote.version = Array.isArray(notes) ? `${notes.length} 条命中` : 'ok';
  } catch (e) {
    result.getnote.error = e.message.slice(0, 200);
  }

  if (deep && !result.codex.error) {
    const sandbox = cfg.codex?.sandbox || 'approve-for-me';
    const args = [
      ...bin.args, 'exec', '--json', '--skip-git-repo-check',
      ...(sandbox === 'approve-for-me' ? ['--approve-for-me'] : ['--sandbox', sandbox]),
      ...(cfg.codex?.model ? ['-m', cfg.codex.model] : []),
      ...(cfg.codex?.extraArgs || []),
      '只回复两个字：连通',
    ];
    const t0 = Date.now();
    const r = await run(bin.cmd, args, { timeout: (cfg.codex?.timeoutSec || 900) * 1000, cwd: root });
    let reply = null, threadId = null, errLine = null;
    for (const line of String(r.stdout || '').split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      let ev; try { ev = JSON.parse(t); } catch { continue; }
      if (ev.type === 'thread.started') threadId = ev.thread_id;
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') reply = ev.item.text;
      if (ev.type === 'item.completed' && ev.item?.type === 'error') errLine = ev.item.message;
    }
    result.probe = {
      ok: r.code === 0 && !!reply,
      exitCode: r.code,
      reply,
      threadId,
      error: errLine || (r.code !== 0 ? (r.stderr || '').trim().slice(0, 300) : null),
      durationMs: Date.now() - t0,
    };
  }

  result.ok = !!result.codex.version && result.getnote.ok && (result.probe ? result.probe.ok : true);
  result.durationMs = Date.now() - started;
  return result;
}
