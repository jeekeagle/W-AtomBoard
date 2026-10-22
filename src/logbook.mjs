import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ontologyJSON, ontologyMarkdown } from './ontology.mjs';
import { fmtDateTime } from './time.mjs';
/** 终态：进入后不再计入「未完成」。 */
const TERMINAL = new Set(['done']);

const LOG_LIMIT = 800;

export function logPaths(root) {
  const dir = path.join(root, 'logs');
  return {
    dir,
    jsonl: path.join(dir, 'events.jsonl'),
    md: path.join(dir, 'LOG.md'),
    state: path.join(dir, 'STATE.md'),
    ontologyJson: path.join(root, 'ontology', 'watomboard.json'),
    ontologyMd: path.join(root, 'ontology', 'WATOMBOARD.md'),
    cursor: path.join(root, 'data', 'log.cursor.json'),
  };
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function readCursor(root) {
  const p = logPaths(root).cursor;
  if (!existsSync(p)) return { lastEventId: 0 };
  try { return { lastEventId: Number(JSON.parse(readFileSync(p, 'utf8')).lastEventId) || 0 }; }
  catch { return { lastEventId: 0 }; }
}

function writeCursor(root, lastEventId) {
  const p = logPaths(root).cursor;
  ensureDir(path.dirname(p));
  writeFileSync(p, JSON.stringify({ lastEventId }, null, 2), 'utf8');
}

/** 把本体写到磁盘（人读 + 机读） */
export function writeOntology(root) {
  const p = logPaths(root);
  ensureDir(path.dirname(p.ontologyMd));
  writeFileSync(p.ontologyMd, ontologyMarkdown(), 'utf8');
  writeFileSync(p.ontologyJson, ontologyJSON(), 'utf8');
  return p;
}

/**
 * 把数据库事件投影成所有 Agent 可读的磁盘 Log。
 * events.jsonl 只追加、绝不改写 —— 这是跨 Agent 的共享事实来源。
 */
export function syncLog(root, db) {
  const p = logPaths(root);
  ensureDir(p.dir);

  // 1) 追加新事件
  const cursor = readCursor(root);
  const rows = db.prepare(`
    SELECT e.id, e.atom_id, e.ts, e.type, e.actor, e.message, e.data,
           a.title AS atom_title, a.project_id, pr.name AS project_name, pr.key AS project_key
    FROM events e
    LEFT JOIN atoms a ON a.id = e.atom_id
    LEFT JOIN projects pr ON pr.id = a.project_id
    WHERE e.id > ?
    ORDER BY e.id`).all(cursor.lastEventId);

  if (rows.length) {
    const lines = rows.map(r => JSON.stringify({
      id: r.id, ts: r.ts, type: r.type, actor: r.actor,
      atom: r.atom_id, atom_title: r.atom_title || null,
      project: r.project_key || null, project_name: r.project_name || null,
      message: r.message || '', data: safeParse(r.data),
    })).join('\n') + '\n';
    appendFileSync(p.jsonl, lines, 'utf8');
    writeCursor(root, rows[rows.length - 1].id);
  }

  // 2) 重写可读 Log
  const recent = db.prepare(`
    SELECT e.id, e.atom_id, e.ts, e.type, e.actor, e.message,
           a.title AS atom_title, pr.key AS project_key
    FROM events e
    LEFT JOIN atoms a ON a.id = e.atom_id
    LEFT JOIN projects pr ON pr.id = a.project_id
    ORDER BY e.id DESC LIMIT ?`).all(LOG_LIMIT).reverse();

  const md = [];
  md.push('# W-AtomBoard 全局 Log');
  md.push('');
  md.push('> 追加式事件流水。所有 Agent 共用同一份事实来源；只追加，不改写。');
  md.push('');
  md.push(`生成时间：${fmtDateTime(new Date())}（北京时间） · 展示最近 ${recent.length} 条（共 ${db.prepare('SELECT COUNT(*) AS n FROM events').get().n} 条）`);
  md.push('');
  md.push('机器可读版本：`logs/events.jsonl`（每行一个 JSON）');
  md.push('');
  md.push('| 时间 | 原子 | 项目 | 类型 | 主体 | 内容 |');
  md.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of recent) {
    md.push(`| ${fmtDateTime(r.ts)} | ${r.atom_id || '—'} | ${r.project_key || '—'} | ${r.type} | ${r.actor || '—'} | ${mdEscape(r.message || '')} |`);
  }
  md.push('');
  writeFileSync(p.md, md.join('\n'), 'utf8');

  // 3) 状态快照
  writeState(root, db);
  return { appended: rows.length, total: recent.length };
}

export function writeState(root, db) {
  const p = logPaths(root);
  ensureDir(p.dir);
  const projects = db.prepare('SELECT * FROM projects ORDER BY id').all();
  const atoms = db.prepare('SELECT * FROM atoms ORDER BY seq').all();
  const byProject = new Map();
  for (const a of atoms) {
    if (!byProject.has(a.project_id)) byProject.set(a.project_id, []);
    byProject.get(a.project_id).push(a);
  }

  const L = [];
  L.push('# W-AtomBoard 当前状态');
  L.push('');
  L.push(`> 快照时间：${fmtDateTime(new Date())}（北京时间）`);
  L.push('');
  L.push(`项目 ${projects.length} 个 · 原子 ${atoms.length} 个`);
  L.push('');
  for (const pr of projects) {
    const list = byProject.get(pr.id) || [];
    const open = list.filter(a => !TERMINAL.has(a.status)).length;
    L.push(`## ${pr.name} \`${pr.key}\``);
    L.push('');
    if (pr.description) { L.push(pr.description); L.push(''); }
    if (!list.length) { L.push('_（暂无原子）_'); L.push(''); continue; }
    L.push('| 原子 | 标题 | 状态 | 进度 | 执行体 | 更新时间 |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const a of list) {
      const ms = (parseMentions(a.mentions) || []).map(m => '@' + m.name).join(' ');
    L.push(`| ${a.id} | ${mdEscape(a.title)} | ${a.status} | ${a.progress}% | ${ms || '—'} | ${fmtDateTime(a.updated_at)} |`);
    }
    L.push('');
    L.push(`未完成 ${open} / 共 ${list.length}`);
    L.push('');
  }
  writeFileSync(p.state, L.join('\n'), 'utf8');
  return p.state;
}

function mdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function parseMentions(t) { try { return JSON.parse(t); } catch { return []; } }
function safeParse(t) { try { return JSON.parse(t); } catch { return {}; } }
