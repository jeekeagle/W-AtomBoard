import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listAtoms } from './store.mjs';
import { projectFolder, atomFolder, ensureDir } from './workspaces.mjs';

/**
 * 写作版的核心度量：字数与稿件。
 *
 * 这里不维护「字数表」，而是把 Atom 工作目录里的真实 Markdown 当成事实来源。
 * 这样 Codex 写进文件的每一个字，都会在看板上立刻可见，不需要额外交互。
 */

const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** 这些目录放素材/参考，不计入正文字数 */
const NON_MANUSCRIPT_DIRS = new Set([
  '.watomboard', '.git', 'node_modules',
  '素材', '素材库', '资料', '参考', '参考文献',
  'notes', 'note', 'materials', 'references', 'refs',
]);

const MANUSCRIPT_EXTS = new Set(['.md', '.markdown', '.txt']);

/** 中文字符按字计，英文/数字按词计；剔除代码块、链接地址与 HTML 标签 */
export function countWords(text) {
  let s = String(text || '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/~~~[\s\S]*?~~~/g, ' ');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  const cjk = (s.match(CJK_RE) || []).length;
  const latin = (s.replace(CJK_RE, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return cjk + latin;
}

/** 读取单个文本文件并计字；读不了就返回 0 */
export function countFileWords(file) {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > MAX_TEXT_BYTES) return 0;
    return countWords(readFileSync(file, 'utf8'));
  } catch {
    return 0;
  }
}

function isManuscriptPath(rel) {
  const parts = String(rel).replace(/\\/g, '/').split('/');
  if (parts.some(p => NON_MANUSCRIPT_DIRS.has(p.toLowerCase()) || NON_MANUSCRIPT_DIRS.has(p))) return false;
  return MANUSCRIPT_EXTS.has(path.extname(rel).toLowerCase());
}

/**
 * 汇总一个 Atom 目录里的正文文件。
 * 返回 { words, files:[{path,words}], mtime }
 */
export function collectDraftFiles(folder) {
  if (!folder || !existsSync(folder)) return { words: 0, files: [], mtime: null };
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (NON_MANUSCRIPT_DIRS.has(e.name) || NON_MANUSCRIPT_DIRS.has(e.name.toLowerCase())) continue;
        walk(abs, depth + 1);
      } else if (isManuscriptPath(e.name)) {
        const words = countFileWords(abs);
        const rel = path.relative(folder, abs).replace(/\\/g, '/');
        out.push({ path: rel, words, mtime: safeMtime(abs) });
      }
    }
  };
  walk(folder, 0);
  out.sort((a, b) => a.path.localeCompare(b.path));
  const mtime = out.reduce((acc, f) => (f.mtime && f.mtime > (acc || '') ? f.mtime : acc), null);
  return { words: out.reduce((n, f) => n + f.words, 0), files: out, mtime };
}

function safeMtime(abs) {
  try { return new Date(statSync(abs).mtimeMs).toISOString(); } catch { return null; }
}

/**
 * 项目写作统计：每个 Atom 的正文字数 + 目标字数 + 项目总量。
 * 只统计走「稿件」路径的文件，素材与参考不计入。
 */
export function projectWritingStats(db, root, project, cfg) {
  const atoms = listAtoms(db, { project: project.key, limit: 2000 });
  const rows = [];
  let totalWords = 0;
  let totalGoal = 0;
  for (const atom of atoms) {
    const folder = atomFolder(root, atom, project, cfg);
    const draft = collectDraftFiles(folder);
    totalWords += draft.words;
    totalGoal += Number(atom.word_goal) || 0;
    rows.push({
      atom_id: atom.id,
      title: atom.title,
      status: atom.status,
      words: draft.words,
      word_goal: Number(atom.word_goal) || 0,
      files: draft.files.length,
      updated_at: draft.mtime || atom.updated_at,
    });
  }
  rows.sort((a, b) => a.atom_id.localeCompare(b.atom_id, 'zh-Hans-CN', { numeric: true }));
  return {
    ok: true,
    project_id: project.id,
    project_name: project.name,
    folder: projectFolder(root, project, cfg),
    total_words: totalWords,
    total_goal: totalGoal,
    atom_count: atoms.length,
    atoms: rows,
  };
}

/** 正文文件优先级：draft.md 最高，其次同名章稿，最后取最大的那份 */
const CANONICAL = ['draft.md', '正文.md', '稿件.md', 'chapter.md', 'index.md'];

export function pickManuscriptFile(folder) {
  if (!folder || !existsSync(folder)) return null;
  for (const name of CANONICAL) {
    const p = path.join(folder, name);
    if (existsSync(p)) return p;
  }
  const draft = collectDraftFiles(folder);
  const candidates = draft.files.filter(f => f.words > 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.words - a.words);
  return path.join(folder, candidates[0].path);
}

/** 读取一个 Atom 的正文（用于拼书稿） */
export function readManuscript(folder) {
  const file = pickManuscriptFile(folder);
  if (!file) return '';
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

/**
 * 把项目内的 Atom 正文章节按顺序拼成一份完整书稿。
 * @param {object} opts { onlyStatuses: string[]|null, title: string }
 */
export function buildManuscript(db, root, project, cfg, opts = {}) {
  const only = Array.isArray(opts.onlyStatuses) && opts.onlyStatuses.length ? new Set(opts.onlyStatuses) : null;
  const atoms = listAtoms(db, { project: project.key, limit: 2000 })
    .sort((a, b) => a.seq - b.seq);

  const chapters = [];
  for (const atom of atoms) {
    if (only && !only.has(atom.status)) continue;
    const folder = atomFolder(root, atom, project, cfg);
    const body = readManuscript(folder).trim();
    if (!body) continue;
    chapters.push({
      atom_id: atom.id,
      title: atom.title,
      status: atom.status,
      words: countWords(body),
      body,
    });
  }

  const totalWords = chapters.reduce((n, c) => n + c.words, 0);
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const head = [
    `# ${opts.title || project.name}`,
    '',
    `> 由 W-AtomBoard 汇总 · ${date} · ${chapters.length} 章 · 约 ${totalWords.toLocaleString('en-US')} 字`,
    '',
  ];

  const body = chapters.map((c, i) => [
    `## ${String(i + 1).padStart(2, '0')}　${c.title}`,
    '',
    c.body,
    '',
  ].join('\n')).join('\n');

  return {
    markdown: head.join('\n') + body,
    chapters,
    total_words: totalWords,
  };
}

/** 导出书稿到 <项目目录>/manuscript/全书稿-YYYY-MM-DD.md */
export function exportManuscript(db, root, project, cfg, opts = {}) {
  const built = buildManuscript(db, root, project, cfg, opts);
  const dir = ensureDir(path.join(projectFolder(root, project, cfg), 'manuscript'));
  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const file = path.join(dir, `全书稿-${stamp}.md`);
  writeFileSync(file, built.markdown, 'utf8');
  return {
    ...built,
    ok: true,
    file,
    rel: path.relative(projectFolder(root, project, cfg), file).replace(/\\/g, '/'),
  };
}

/** 项目级成果（书稿、封面、目录等）—— 不属于任何 Atom，但属于项目 */
export function collectProjectLevelFiles(root, project, cfg, atomFolders = []) {
  const dir = projectFolder(root, project, cfg);
  if (!existsSync(dir)) return [];
  const skip = new Set(atomFolders.map(p => path.resolve(p)));
  const out = [];
  const walk = (cur, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (skip.has(path.resolve(abs))) continue;
        walk(abs, depth + 1);
      } else {
        const rel = path.relative(dir, abs).replace(/\\/g, '/');
        const st = statSync(abs);
        out.push({ abs, rel, name: e.name, size: st.size, mtime: new Date(st.mtimeMs).toISOString() });
      }
    }
  };
  walk(dir, 0);
  return out;
}
