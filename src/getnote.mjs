import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();

/** 找到 getnote 的 Node 入口，绕过 cmd.exe（避免引号/编码问题） */
export function resolveGetnote() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', '@getnote', 'cli', 'bin', 'getnote.js'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@getnote', 'cli', 'bin', 'getnote.js'),
    path.join(HOME, '.npm-global', 'node_modules', '@getnote', 'cli', 'bin', 'getnote.js'),
  ];
  const wingetBase = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(wingetBase)) {
    for (const pkg of readdirSync(wingetBase)) {
      candidates.push(path.join(wingetBase, pkg, 'node-v24.19.0-win-x64', 'node_modules', '@getnote', 'cli', 'bin', 'getnote.js'));
    }
  }
  for (const js of candidates) {
    if (js && existsSync(js)) return { cmd: process.execPath, baseArgs: [js] };
  }
  return { cmd: 'getnote', baseArgs: [], shell: true };
}

function runNode(cmd, args, { cwd, timeout = 90000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      cwd, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeout);
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, stdout: '', stderr: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: out, stderr: err }); });
  });
}

function runShell(cmd, args) {
  return new Promise(resolve => {
    const q = a => (/[\s"&|<>^()%]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    const line = [cmd, ...args].map(q).join(' ');
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => resolve({ code: -1, stdout: '', stderr: e.message }));
    child.on('close', code => resolve({ code, stdout: out, stderr: err }));
  });
}

export async function getnote(args, opts = {}) {
  const { cmd, baseArgs, shell } = resolveGetnote();
  const res = shell ? await runShell(cmd, args) : await runNode(cmd, [...baseArgs, ...args], opts);
  if (res.code !== 0) {
    throw new Error(`getnote ${args[0]} 失败 (${res.code}): ${(res.stderr || res.stdout).trim().slice(0, 600)}`);
  }
  return res.stdout;
}

export async function getnoteJson(args, opts = {}) {
  const raw = await getnote([...args, '-o', 'json'], opts);
  return parseMaybeJson(raw);
}

function parseMaybeJson(raw) {
  const t = String(raw).trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.search(/[[{]/);
  if (start > 0) { try { return JSON.parse(t.slice(start)); } catch { /* fall through */ } }
  return t;
}

/* ---------- 高层封装 ---------- */

export async function searchNotes(query, { limit = 5, kb = null, snippet = true } = {}) {
  const args = ['search', query, '--limit', String(limit)];
  if (kb) args.push('--kb', kb);
  if (snippet) args.push('--response-mode', 'snippet', '--max-snippet-chars', '600');
  return normalizeNotes(await getnoteJson(args));
}

export async function getNote(id) {
  return getnoteJson(['note', id]);
}

export async function saveNote({ text, title, tags = [], topicId = null, parentId = null, idempotencyKey = null }) {
  const args = ['save'];
  if (text && text.startsWith('file:')) args.push('--content-file', text.slice(5));
  else if (text) args.push(text);
  if (title) args.push('--title', title);
  for (const t of tags) args.push('--tag', t);
  if (topicId) args.push('--topic-id', topicId);
  if (parentId) args.push('--parent-id', parentId);
  if (idempotencyKey) args.push('--idempotency-key', idempotencyKey);
  return getnoteJson(args);
}

export async function listKbs() {
  return getnoteJson(['kbs']);
}

/**
 * 把 getnote 返回统一成 {id,title,snippet,url,kb} 数组。
 * 实际返回形如 { data: { results: [ { resource_type, note:{...}, snippet, title, note_id, ... } ] } }
 */
export function normalizeNotes(data) {
  if (!data) return [];
  const payload = (data && typeof data === 'object' && data.data) ? data.data : data;
  let list = [];
  if (Array.isArray(payload)) list = payload;
  else if (Array.isArray(payload.results)) list = payload.results;
  else if (Array.isArray(payload.notes)) list = payload.notes;
  else if (Array.isArray(payload.data)) list = payload.data;

  return list.map(entry => {
    const n = (entry && entry.note) ? entry.note : (entry || {});
    const id = entry.note_id || n.note_id || n.id || entry.id || '';
    const title = entry.title || n.display_title || n.title || '(无标题)';
    const snippet =
      entry.snippet ||
      entry.content ||
      n.snippet ||
      n.preview?.text ||
      n.content_state?.content ||
      n.content || n.body || n.text || '';
    return {
      id: String(id),
      title: String(title),
      snippet: String(snippet),
      kb: n.topics?.[0]?.topic_id || n.topic_id || null,
      updated_at: n.updated_at || n.timestamps?.edited_at || null,
      url: entry.note_url || n.note_url || '',
      score: entry.score ?? null,
      raw: n,
    };
  }).filter(n => n.id || n.title);
}
