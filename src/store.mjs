import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { eventLevel } from './model.mjs';
import { BRAND } from './brand.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  folder TEXT,
  kb_name TEXT,
  kb_topic_id TEXT,
  kb_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS atoms (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  target TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'normal',
  mentions TEXT NOT NULL DEFAULT '[]',
  progress INTEGER NOT NULL DEFAULT 0,
  thread_id TEXT,
  workspace TEXT,
  assignee TEXT,
  folder TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  atom_id TEXT REFERENCES atoms(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT DEFAULT 'user',
  message TEXT DEFAULT '',
  data TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  atom_id TEXT NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  title TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(atom_id, kind, target)
);

CREATE TABLE IF NOT EXISTS runs (
  atom_id TEXT PRIMARY KEY REFERENCES atoms(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'idle',
  status TEXT NOT NULL DEFAULT 'idle',
  attempt INTEGER NOT NULL DEFAULT 0,
  label TEXT DEFAULT '',
  message TEXT DEFAULT '',
  error TEXT DEFAULT '',
  last_activity TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_atoms_project ON atoms(project_id);
CREATE INDEX IF NOT EXISTS idx_events_atom ON events(atom_id, id);
CREATE INDEX IF NOT EXISTS idx_links_atom ON links(atom_id);
`;

const now = () => new Date().toISOString();

export function openStore(root) {
  const dir = path.join(root, 'data');
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, BRAND.dbFile));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  ensureColumn(db, 'projects', 'folder', 'TEXT');
  ensureColumn(db, 'projects', 'kb_name', 'TEXT');
  ensureColumn(db, 'projects', 'kb_topic_id', 'TEXT');
  ensureColumn(db, 'projects', 'kb_synced_at', 'TEXT');
  ensureColumn(db, 'atoms', 'folder', 'TEXT');
  ensureColumn(db, 'atoms', 'target', 'TEXT');
  ensureColumn(db, 'atoms', 'word_goal', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'runs', 'last_activity', 'TEXT');
  return db;
}

/** 补列（SQLite 的 ALTER TABLE ADD COLUMN 是幂等的） */
function ensureColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some(c => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** 迁移：events.atom_id 允许为空 —— 项目级事件（归档/删除）不属于任何原子 */
function migrate(db) {
  const cols = db.prepare("PRAGMA table_info(events)").all();
  const atomCol = cols.find(c => c.name === 'atom_id');
  if (!atomCol || atomCol.notnull === 0) return;
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(`
    BEGIN;
    CREATE TABLE events_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      atom_id TEXT REFERENCES atoms(id) ON DELETE CASCADE,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      actor TEXT DEFAULT 'user',
      message TEXT DEFAULT '',
      data TEXT DEFAULT '{}'
    );
    INSERT INTO events_migrated (id, atom_id, ts, type, actor, message, data)
      SELECT id, atom_id, ts, type, actor, message, data FROM events;
    DROP TABLE events;
    ALTER TABLE events_migrated RENAME TO events;
    COMMIT;
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_atom ON events(atom_id, id)');
  db.exec('PRAGMA foreign_keys=ON');
}

export function slugifyKey(input) {
  const s = String(input || '').trim().toLowerCase()
    .replace(/[\s_/\\.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')   // 只保留 ASCII，方便命令行引用
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'project';
}

/** 避免 key 冲突：foo, foo-2, foo-3 ... */
export function uniqueKey(db, base) {
  let key = base;
  let i = 1;
  while (getProjectByKey(db, key)) {
    i += 1;
    key = `${base}-${i}`;
  }
  return key;
}

/* ---------------- projects ---------------- */

export function createProject(db, { key, name, description = '', folder = null }) {
  const ts = now();
  const finalKey = uniqueKey(db, key && /^[a-z0-9-]+$/.test(key) ? key : slugifyKey(key || name));
  const info = db.prepare(
    `INSERT INTO projects (key, name, description, status, folder, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?)`
  ).run(finalKey, name || finalKey, description, folder, ts, ts);
  return getProject(db, Number(info.lastInsertRowid));
}

/** 更新项目可写字段（知识库绑定、目录、名称等） */
export function updateProject(db, id, patch = {}) {
  const allowed = ['name', 'description', 'folder', 'status', 'kb_name', 'kb_topic_id', 'kb_synced_at'];
  const fields = [];
  const args = [];
  for (const k of allowed) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); args.push(patch[k]); }
  }
  if (!fields.length) return getProject(db, id);
  fields.push('updated_at = ?');
  args.push(now(), Number(id));
  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getProject(db, id);
}

export function getProject(db, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
}

export function getProjectByKey(db, key) {
  return db.prepare('SELECT * FROM projects WHERE key = ?').get(key);
}

export function setProjectStatus(db, id, status) {
  const ts = now();
  db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, Number(id));
  return getProject(db, id);
}

export function archiveProject(db, id, archived = true) {
  return setProjectStatus(db, id, archived ? 'archived' : 'active');
}

/** 统计项目下的原子数 */
export function countAtoms(db, projectId) {
  return db.prepare('SELECT COUNT(*) AS n FROM atoms WHERE project_id = ?').get(Number(projectId)).n;
}

/** 把项目的原子迁移到另一个项目 */
export function moveAtoms(db, fromProjectId, toProjectId) {
  const n = db.prepare('UPDATE atoms SET project_id = ?, updated_at = ? WHERE project_id = ?')
    .run(Number(toProjectId), now(), Number(fromProjectId)).changes;
  return n;
}

/** 删除项目（外键级联删除其原子） */
export function deleteProject(db, id) {
  return db.prepare('DELETE FROM projects WHERE id = ?').run(Number(id)).changes;
}

export function listProjects(db) {
  return db.prepare(`
    SELECT p.*, COUNT(a.id) AS atom_count,
           SUM(CASE WHEN a.status IN ('todo','in_progress','in_review','blocked') THEN 1 ELSE 0 END) AS open_count
    FROM projects p LEFT JOIN atoms a ON a.project_id = p.id
    GROUP BY p.id ORDER BY p.id`).all();
}

/* ---------------- atoms ---------------- */

export function nextAtomSeq(db) {
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM atoms').get();
  return row.n;
}

export function createAtom(db, { projectId, title, body = '', target = '', status = 'todo', priority = 'normal', mentions = [], progress = 0, workspace = null, assignee = null, wordGoal = 0 }) {
  const seq = nextAtomSeq(db);
  const id = `AT-${seq}`;
  const ts = now();
  db.prepare(`
    INSERT INTO atoms (id, seq, project_id, title, body, target, status, priority, mentions, progress, workspace, assignee, word_goal, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, seq, Number(projectId), title, body, target, status, priority, JSON.stringify(mentions), Number(progress) || 0, workspace, assignee, Number(wordGoal) || 0, ts, ts);
  addEvent(db, id, 'created', 'user', `Atom ${id} 创建：${title}`, { status, priority, mentions, target });
  return getAtom(db, id);
}

export function getAtom(db, id) {
  const row = db.prepare('SELECT * FROM atoms WHERE id = ?').get(id);
  if (!row) return null;
  return hydrateAtom(row);
}

export function listAtoms(db, { project, status, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (project) {
    const p = /^\d+$/.test(String(project)) ? getProject(db, project) : getProjectByKey(db, project);
    if (!p) return [];
    where.push('a.project_id = ?');
    args.push(p.id);
  }
  if (status) {
    const list = String(status).split(',').map(s => s.trim()).filter(Boolean);
    where.push(`a.status IN (${list.map(() => '?').join(',')})`);
    args.push(...list);
  }
  const sql = `SELECT a.* FROM atoms a ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY a.seq DESC LIMIT ?`;
  return db.prepare(sql).all(...args, Number(limit)).map(hydrateAtom);
}

export function updateAtom(db, id, patch = {}) {
  const fields = [];
  const args = [];
  const allowed = ['title', 'body', 'target', 'status', 'priority', 'progress', 'thread_id', 'workspace', 'assignee', 'folder', 'word_goal'];
  for (const k of allowed) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); args.push(patch[k]); }
  }
  if (patch.mentions !== undefined) { fields.push('mentions = ?'); args.push(JSON.stringify(patch.mentions)); }
  if (!fields.length) return getAtom(db, id);
  fields.push('updated_at = ?');
  args.push(now(), id);
  db.prepare(`UPDATE atoms SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getAtom(db, id);
}

export function deleteAtom(db, id) {
  return db.prepare('DELETE FROM atoms WHERE id = ?').run(id).changes;
}

/* ---------------- runs（Codex 执行进度） ---------------- */

/**
 * 写入/更新一个 Atom 的执行态。
 * - bumpAttempt: true 表示这是一次新的尝试，attempt + 1
 * - 未提供的字段沿用数据库里的旧值，避免调用方每次都要传全量
 */
export function upsertRun(db, atomId, patch = {}) {
  const prev = getRun(db, atomId);
  const ts = now();
  let attempt = prev ? Number(prev.attempt) || 0 : 0;
  if (patch.attempt !== undefined) attempt = Number(patch.attempt) || 0;
  else if (patch.bumpAttempt) attempt += 1;

  const row = {
    atom_id: atomId,
    phase: patch.phase !== undefined ? String(patch.phase) : (prev?.phase || 'idle'),
    status: patch.status !== undefined ? String(patch.status) : (prev?.status || 'idle'),
    attempt,
    label: patch.label !== undefined ? String(patch.label) : (prev?.label || ''),
    message: patch.message !== undefined ? String(patch.message) : (prev?.message || ''),
    error: patch.error !== undefined ? String(patch.error || '') : (prev?.error || ''),
    last_activity: patch.last_activity !== undefined ? patch.last_activity : (prev?.last_activity || null),
    started_at: patch.started_at !== undefined ? patch.started_at : (prev?.started_at || null),
    finished_at: patch.finished_at !== undefined ? patch.finished_at : (prev?.finished_at || null),
    updated_at: ts,
  };

  db.prepare(`
    INSERT INTO runs (atom_id, phase, status, attempt, label, message, error,
                      last_activity, started_at, finished_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(atom_id) DO UPDATE SET
      phase = excluded.phase,
      status = excluded.status,
      attempt = excluded.attempt,
      label = excluded.label,
      message = excluded.message,
      error = excluded.error,
      last_activity = excluded.last_activity,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      updated_at = excluded.updated_at
  `).run(
    row.atom_id, row.phase, row.status, row.attempt, row.label, row.message, row.error,
    row.last_activity, row.started_at, row.finished_at, row.updated_at
  );
  return getRun(db, atomId);
}

export function getRun(db, atomId) {
  return db.prepare('SELECT * FROM runs WHERE atom_id = ?').get(atomId) || null;
}

export function listRuns(db, { limit = 100 } = {}) {
  return db.prepare(`
    SELECT * FROM runs
    ORDER BY CASE
      WHEN status IN ('running', 'starting') THEN 0
      WHEN status = 'failed' THEN 1
      ELSE 2
    END, updated_at DESC
    LIMIT ?
  `).all(Number(limit));
}

export function deleteRun(db, atomId) {
  return db.prepare('DELETE FROM runs WHERE atom_id = ?').run(atomId).changes;
}

/* ---------------- events ---------------- */

export function addEvent(db, atomId, type, actor = 'user', message = '', data = {}) {
  const info = db.prepare(
    'INSERT INTO events (atom_id, ts, type, actor, message, data) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(atomId, now(), type, actor, message, JSON.stringify(data));
  return info.lastInsertRowid;
}

export function listEvents(db, atomId, { after = 0, limit = 500 } = {}) {
  return db.prepare(
    'SELECT * FROM events WHERE atom_id = ? AND id > ? ORDER BY id LIMIT ?'
  ).all(atomId, Number(after), Number(limit)).map(r => ({ ...r, data: safeParse(r.data), level: eventLevel(r.type) }));
}

/** 项目级事件（atom_id 为空） */
export function listProjectEvents(db, { after = 0, limit = 200 } = {}) {
  return db.prepare(
    'SELECT * FROM events WHERE atom_id IS NULL AND id > ? ORDER BY id LIMIT ?'
  ).all(Number(after), Number(limit)).map(r => ({ ...r, data: safeParse(r.data) }));
}

export function lastEventId(db, atomId) {
  const row = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM events WHERE atom_id = ?').get(atomId);
  return row.n;
}

/* ---------------- links ---------------- */

export function addLink(db, atomId, kind, target, title = '') {
  db.prepare(
    'INSERT OR IGNORE INTO links (atom_id, kind, target, title, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(atomId, kind, target, title, now());
  return db.prepare('SELECT * FROM links WHERE atom_id = ? AND kind = ? AND target = ?').get(atomId, kind, target);
}

export function listLinks(db, atomId) {
  return db.prepare('SELECT * FROM links WHERE atom_id = ? ORDER BY id').all(atomId);
}

export function removeLink(db, atomId, kind, target) {
  return db.prepare('DELETE FROM links WHERE atom_id = ? AND kind = ? AND target = ?').run(atomId, kind, target).changes;
}

/* ---------------- helpers ---------------- */

function hydrateAtom(row) {
  return { ...row, mentions: safeParse(row.mentions, []) };
}

function safeParse(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export { now };

