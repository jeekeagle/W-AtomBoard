import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getnoteJson } from './getnote.mjs';
import { listAtoms, listEvents, updateProject } from './store.mjs';
import { scanArtifacts } from './artifacts.mjs';
import { projectFolder, atomFolder, ensureDir } from './workspaces.mjs';
import { BRAND } from './brand.mjs';
import { collectProjectLevelFiles } from './writing.mjs';

/**
 * 项目资源 = 两类事实的汇总：
 *   1. 本地资源：项目下每个 Atom 工作目录里真实存在的文件
 *   2. 得到大脑资源：项目同名知识库 WATOM-<项目名> 的笔记快照
 *
 * Getnote 文档落到 <项目目录>/.watomboard/getnote/，索引写 _index.json。
 * 这样 Codex 在项目里工作时可以直接读本地快照，而看板只负责同步与展示。
 */

export function kbNameForProject(project) {
  return `${BRAND.kbPrefix}${String(project?.name || project?.key || '').trim()}`;
}

export function getnoteCacheDir(root, project, cfg) {
  return path.join(projectFolder(root, project, cfg), '.watomboard', 'getnote');
}

/** 列出得到大脑知识库，统一成 {topic_id,name,note_count} */
export async function listKnowledgeBases() {
  const raw = await getnoteJson(['kbs']);
  if (raw && raw.success === false) {
    throw new Error(raw.error || raw.message || '读取知识库失败');
  }
  const data = raw?.data || raw || {};
  const topics = Array.isArray(data.topics) ? data.topics
    : Array.isArray(data.kbs) ? data.kbs
      : Array.isArray(data) ? data : [];
  return topics.map(t => ({
    topic_id: String(t.topic_id || t.id || ''),
    name: String(t.name || t.title || ''),
    note_count: Number(t.stats?.note_count ?? t.note_count ?? 0),
  })).filter(t => t.topic_id && t.name);
}

/**
 * 精确查找 ATOM-<项目名>；不存在则创建。
 * 绝不复用大小写或名称近似但不同的旧知识库。
 */
export async function findOrCreateProjectKb(project, { create = true } = {}) {
  const name = kbNameForProject(project);
  if (!name || name === 'ATOM-') throw new Error('项目名为空，无法生成知识库名');

  const topics = await listKnowledgeBases();
  const found = topics.find(t => t.name === name);
  if (found) return { ...found, name, created: false };
  if (!create) return { topic_id: '', name, note_count: 0, created: false };

  const raw = await getnoteJson(['kb', 'create', name]);
  if (raw && raw.success === false) {
    throw new Error(raw.error || raw.message || `创建知识库 ${name} 失败`);
  }
  const d = raw?.data || raw || {};
  let topicId = d.topic_id || d.id || d.topic?.topic_id || d.topic?.id || d.kb?.topic_id || d.kb?.id || '';
  if (!topicId) {
    // 有些 CLI 版本创建成功只返回 success；再列一次，按精确名称取真实 id。
    const after = await listKnowledgeBases();
    const hit = after.find(t => t.name === name);
    topicId = hit?.topic_id || '';
  }
  if (!topicId) throw new Error(`知识库 ${name} 已创建，但未能取得 topic_id`);
  return { topic_id: String(topicId), name, note_count: 0, created: true };
}

/** 确保项目已绑定知识库，并返回最新 project 行。 */
export async function ensureProjectKb(db, project, { create = true } = {}) {
  const kbName = kbNameForProject(project);
  if (project.kb_topic_id && project.kb_name === kbName) {
    return { project, kb: { topic_id: project.kb_topic_id, name: kbName, created: false } };
  }
  const kb = await findOrCreateProjectKb(project, { create });
  const next = updateProject(db, project.id, {
    kb_name: kb.name,
    ...(kb.topic_id ? { kb_topic_id: kb.topic_id } : {}),
  });
  return { project: next, kb };
}

/** 读取知识库内全部笔记（列表层，不含正文） */
export async function fetchKbNotes(topicId) {
  const raw = await getnoteJson(['kb', topicId, '--all', '--page-size', '100']);
  if (raw && raw.success === false) {
    throw new Error(raw.error || raw.message || '读取知识库笔记失败');
  }
  const data = raw?.data || raw || {};
  const notes = Array.isArray(data.notes) ? data.notes
    : Array.isArray(data.results) ? data.results : [];
  return notes.map(n => ({
    note_id: String(n.note_id || n.id || ''),
    title: String(n.display_title || n.title || '(无标题)'),
    preview: String(n.preview?.text || n.snippet || ''),
    url: String(n.note_url || n.url || ''),
    created_at: String(n.timestamps?.created_at || n.created_at || ''),
    updated_at: String(n.timestamps?.edited_at || n.edit_time || n.updated_at || ''),
  })).filter(n => n.note_id);
}

/** 读取单篇笔记全文 */
export async function fetchNoteDetail(noteId) {
  const raw = await getnoteJson(['note', noteId]);
  if (raw && raw.success === false) {
    throw new Error(raw.error || raw.message || '读取笔记失败');
  }
  const d = raw?.data || raw || {};
  const note = d.note || d;
  return {
    note_id: String(note.note_id || note.id || noteId),
    title: String(note.display_title || note.title || '(无标题)'),
    content: String(note.content || note.content_state?.content || d.content || ''),
    url: String(note.note_url || note.url || ''),
  };
}

function safeName(value, fallback = 'untitled') {
  const s = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 60);
  return s || fallback;
}

function readIndex(cacheDir) {
  const file = path.join(cacheDir, '_index.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return Array.isArray(parsed?.documents) ? parsed.documents : [];
  } catch {
    return [];
  }
}

function writeIndex(cacheDir, documents) {
  const file = path.join(cacheDir, '_index.json');
  writeFileSync(file, JSON.stringify({
    synced_at: new Date().toISOString(),
    documents,
  }, null, 2), 'utf8');
}

function writeReadme(cacheDir, project, documents) {
  const lines = [
    `# ${kbNameForProject(project)} · 得到大脑同步`,
    '',
    `> 本地快照目录：\`.watomboard/getnote\``,
    `> 文档数：${documents.length}`,
    '',
    '| 文档 | 更新时间 | 本地文件 |',
    '| --- | --- | --- |',
    ...documents.map(d => `| ${d.title.replace(/\|/g, '\\|')} | ${d.updated_at || ''} | [${d.path}](${d.path}) |`),
    '',
  ];
  writeFileSync(path.join(cacheDir, 'README.md'), lines.join('\n'), 'utf8');
}

/**
 * 增量同步得到大脑知识库到项目目录。
 * edited_at 未变化且本地文件仍存在时，跳过正文下载。
 */
export async function syncProjectGetnote(db, root, project, cfg, { force = false } = {}) {
  const bound = await ensureProjectKb(db, project);
  project = bound.project;
  const kb = bound.kb;
  if (!kb.topic_id) throw new Error('项目尚未绑定得到大脑知识库');

  const folder = ensureDir(projectFolder(root, project, cfg));
  const cacheDir = ensureDir(getnoteCacheDir(root, project, cfg));
  const previous = new Map(readIndex(cacheDir).map(d => [d.note_id, d]));
  const notes = await fetchKbNotes(kb.topic_id);
  const documents = [];
  const warnings = [];

  for (const note of notes) {
    const prev = previous.get(note.note_id);
    const rel = prev?.path || path.posix.join('.watomboard', 'getnote', `${safeName(note.note_id)}-${safeName(note.title, 'note')}.md`);
    const abs = path.join(folder, rel.replace(/\//g, path.sep));
    const unchanged = !force && prev && prev.updated_at === note.updated_at && existsSync(abs);
    if (unchanged) {
      documents.push({ ...prev, title: note.title || prev.title, url: note.url || prev.url });
      continue;
    }

    let detail;
    try {
      detail = await fetchNoteDetail(note.note_id);
    } catch (err) {
      warnings.push(`${note.title}：正文读取失败，使用摘要（${err.message}）`);
      detail = { note_id: note.note_id, title: note.title, content: note.preview, url: note.url };
    }

    const title = detail.title || note.title;
    const content = detail.content || note.preview || '（无正文）';
    const body = [
      '---',
      `note_id: ${JSON.stringify(detail.note_id)}`,
      `title: ${JSON.stringify(title)}`,
      `kb: ${JSON.stringify(kbNameForProject(project))}`,
      `url: ${JSON.stringify(detail.url || note.url || '')}`,
      `created_at: ${JSON.stringify(note.created_at || '')}`,
      `updated_at: ${JSON.stringify(note.updated_at || '')}`,
      '---',
      '',
      `# ${title}`,
      '',
      content,
      '',
    ].join('\n');
    writeFileSync(abs, body, 'utf8');

    documents.push({
      note_id: note.note_id,
      title,
      path: rel,
      url: detail.url || note.url || '',
      created_at: note.created_at || '',
      updated_at: note.updated_at || '',
      synced_at: new Date().toISOString(),
      chars: content.length,
    });
  }

  writeIndex(cacheDir, documents);
  writeReadme(cacheDir, project, documents);
  const syncedAt = new Date().toISOString();
  project = updateProject(db, project.id, { kb_synced_at: syncedAt });
  return {
    ok: true,
    project,
    kb: { topic_id: kb.topic_id, name: kbNameForProject(project) },
    folder,
    synced_at: syncedAt,
    total: documents.length,
    downloaded: documents.filter(d => !previous.has(d.note_id) || previous.get(d.note_id)?.updated_at !== d.updated_at).length,
    documents,
    warnings,
  };
}

/** 列出项目下全部 Atom 的本地成果（项目相对路径） */
export function collectLocalResources(db, root, project, cfg) {
  const projectDir = projectFolder(root, project, cfg);
  const atoms = listAtoms(db, { project: project.key, limit: 1000 });
  const out = [];
  const atomDirs = [];
  for (const atom of atoms) {
    const folder = atomFolder(root, atom, project, cfg);
    atomDirs.push(folder);
    if (!existsSync(folder)) continue;
    const events = listEvents(db, atom.id);
    for (const artifact of scanArtifacts(folder, events)) {
      const abs = path.join(folder, artifact.path);
      const rel = path.relative(projectDir, abs).replace(/\\/g, '/');
      if (!rel || rel.startsWith('../') || rel.startsWith('.watomboard/')) continue;
      out.push({
        ...artifact,
        atom_id: atom.id,
        atom_title: atom.title,
        atom_path: artifact.path,
        path: rel,
        abs,
      });
    }
  }
  // 项目级文件（全书稿、封面、目录等）：不属于任何 Atom，但属于这个项目
  for (const f of collectProjectLevelFiles(root, project, cfg, atomDirs)) {
    if (f.rel.startsWith('.watomboard/')) continue;
    out.push({
      path: f.rel,
      name: f.name,
      type: path.extname(f.name).slice(1).toLowerCase() || 'file',
      label: '项目文件',
      stage: '项目级',
      actor_label: '项目',
      mtime: f.mtime,
      size: f.size,
      abs: f.abs,
      atom_id: null,
      atom_title: '',
      atom_path: f.rel,
      project_level: true,
    });
  }
  out.sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime) || a.path.localeCompare(b.path));
  return out;
}

/** 读取本地 Getnote 快照索引（不触发网络） */
export function collectGetnoteResources(root, project, cfg) {
  const cacheDir = getnoteCacheDir(root, project, cfg);
  if (!existsSync(cacheDir)) return [];
  return readIndex(cacheDir)
    .filter(d => existsSync(path.join(cacheDir, path.basename(d.path))))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export function getProjectResources(db, root, project, cfg) {
  const folder = projectFolder(root, project, cfg);
  return {
    ok: true,
    project: { ...project, folder },
    folder,
    kb_name: project.kb_name || kbNameForProject(project),
    kb_topic_id: project.kb_topic_id || '',
    kb_synced_at: project.kb_synced_at || '',
    local: collectLocalResources(db, root, project, cfg),
    getnote: collectGetnoteResources(root, project, cfg),
  };
}

/** 安全解析项目内相对路径（资源打开/定位） */
export function resolveProjectResource(root, project, cfg, rel) {
  const folder = path.resolve(projectFolder(root, project, cfg));
  const target = path.resolve(folder, String(rel || ''));
  if (target !== folder && !target.startsWith(folder + path.sep)) {
    throw new Error('非法文件路径');
  }
  if (!existsSync(target)) throw new Error('文件不存在');
  return target;
}

export function ensureGetnoteCacheDir(root, project, cfg) {
  return ensureDir(getnoteCacheDir(root, project, cfg));
}

export function listGetnoteCacheFiles(root, project, cfg) {
  const dir = getnoteCacheDir(root, project, cfg);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => n.endsWith('.md')).map(n => path.join(dir, n));
}
