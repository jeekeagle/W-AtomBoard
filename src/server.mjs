import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { listProjects, listAtoms, getAtom, updateAtom, deleteAtom, addEvent, listEvents, listLinks, getProject, createAtom, createProject, archiveProject, deleteProject, countAtoms, moveAtoms, setProjectStatus, listRuns, getRun, updateProject } from './store.mjs';
import { STATUSES, isStatus, isPriority, progressForStatus, labelOf } from './model.mjs';
import { listTargets } from './mentions.mjs';
import { effectiveStyle, readSettings, writeSettings, readRegistry } from './settings.mjs';
import { parseMentions } from './mentions.mjs';
import { readConfig, saveConfig, testConnection, resolveCodex } from './config.mjs';
import { syncLog, writeOntology, logPaths } from './logbook.mjs';
import { buildTimeline, timelineDesc } from './timeline.mjs';
import { applyTransition, readTransitions, writeTransitions } from './transitions.mjs';
import { projectFolder, atomFolder, ensureDir, openFolder, openFile, revealFile, prepareAtomFolder } from './workspaces.mjs';
import { scanArtifacts, resolveArtifact, classOf } from './artifacts.mjs';
import {
  ensureProjectKb, getProjectResources, resolveProjectResource,
  syncProjectGetnote, kbNameForProject, listKnowledgeBases,
} from './projectResources.mjs';
import { BRAND } from './brand.mjs';
import {
  projectWritingStats, buildManuscript, exportManuscript,
  collectDraftFiles, collectProjectLevelFiles,
} from './writing.mjs';

/* 可在线阅读的文本类型：Markdown 优先，其余按等宽文本展示。 */
const TEXT_PREVIEW_EXTS = new Set([
  'md', 'markdown', 'txt', 'csv', 'json', 'yaml', 'yml',
  'js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'ps1', 'sh', 'css',
]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const ASSET_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
};

function assetMime(target) {
  const ext = path.extname(target).slice(1).toLowerCase();
  return ASSET_MIME[ext] || null;
}

function readPreviewText(target, rel) {
  const st = statSync(target);
  if (!st.isFile()) throw new Error('这不是一个文件');
  if (st.size > MAX_TEXT_BYTES) throw new Error('文件超过 2MB，请在本地打开');
  const ext = path.extname(target).slice(1).toLowerCase();
  if (!TEXT_PREVIEW_EXTS.has(ext)) throw new Error('该文件类型暂不支持在线阅读');
  return {
    path: rel,
    name: path.basename(target),
    ext,
    kind: classOf(rel).kind,
    size: st.size,
    mtime: new Date(st.mtimeMs).toISOString(),
    content: readFileSync(target, 'utf8'),
  };
}

export function startServer({ db, root, port = BRAND.defaultPort, host = '127.0.0.1' }) {
  const clients = new Set();

  const cfg = readConfig(root);
  const state = () => {
    const projects = listProjects(db).map(p => ({ ...p, folder: projectFolder(root, p, cfg) }));
    const atoms = listAtoms(db, {}).map(a => {
      const pr = projects.find(p => p.id === a.project_id);
      return { ...a, folder: atomFolder(root, a, pr, cfg) };
    });
    const runs = listRuns(db).map(r => {
      const a = atoms.find(x => x.id === r.atom_id);
      return {
        ...r,
        title: a ? a.title : '(已删除)',
        project_id: a ? a.project_id : null,
        atom_status: a ? a.status : null,
      };
    });
    return { statuses: STATUSES, projects, atoms, runs, updatedAt: new Date().toISOString() };
  };

  const broadcast = (payload) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try { res.write(data); } catch { clients.delete(res); }
    }
  };

  let lastSignature = '';
  const signature = () => {
    const atoms = listAtoms(db, {});
    const events = db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM events').get().n;
    const runs = db.prepare('SELECT COALESCE(MAX(updated_at),0) AS n FROM runs').get().n;
    return `${atoms.length}:${events}:${runs}:${atoms.map(a => `${a.id}${a.status}${a.progress}${a.updated_at}`).join('|')}`;
  };

  const watcher = setInterval(() => {
    try {
    const sig = signature();
    if (sig !== lastSignature) {
      lastSignature = sig;
      broadcast({ type: 'state', state: state() });
      try { syncLog(root, db); } catch { /* 投影失败不影响看板 */ }
    }
    } catch (err) { /* 数据库短暂不可用时忽略 */ }
  }, 700);
  watcher.unref?.();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const send = (code, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(typeof data === 'string' ? data : JSON.stringify(data));
    };
    const sendBinary = (code, buf, type) => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(buf);
    };
    const body = async () => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (!chunks.length) return {};
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
    };

    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const file = path.join(root, 'web', 'index.html');
        if (!existsSync(file)) return send(404, 'not found', 'text/plain');
        return send(200, readFileSync(file, 'utf8'), 'text/html; charset=utf-8');
      }

      /* Markdown 阅读页：独立网页，用它来「好看地」打开成果内容。 */
      if (req.method === 'GET' && (url.pathname === '/preview' || url.pathname === '/preview.html')) {
        const file = path.join(root, 'web', 'preview.html');
        if (!existsSync(file)) return send(404, 'not found', 'text/plain');
        return send(200, readFileSync(file, 'utf8'), 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && /^\/(style|preview)\.css$/.test(url.pathname)) {
        const file = path.join(root, 'web', url.pathname.slice(1));
        if (!existsSync(file)) return send(404, 'not found', 'text/plain');
        return send(200, readFileSync(file, 'utf8'), 'text/css; charset=utf-8');
      }

      if (req.method === 'GET' && /^\/(app|preview)\.js$/.test(url.pathname)) {
        const file = path.join(root, 'web', url.pathname.slice(1));
        if (!existsSync(file)) return send(404, 'not found', 'text/plain');
        return send(200, readFileSync(file, 'utf8'), 'application/javascript; charset=utf-8');
      }

      if (req.method === 'GET' && /^\/vendor\/[A-Za-z0-9._-]+\.js$/.test(url.pathname)) {
        const file = path.join(root, 'web', url.pathname.slice(1));
        if (!existsSync(file)) return send(404, 'not found', 'text/plain');
        return send(200, readFileSync(file, 'utf8'), 'application/javascript; charset=utf-8');
      }

      if (url.pathname === '/api/style') {
        if (req.method === 'GET') return send(200, effectiveStyle(root));
        if (req.method === 'POST') {
          const b = await body();
          const registry = readRegistry(root);
          const patch = {};
          if (b.style && registry.styles.some(s => s.slug === b.style)) patch.style = b.style;
          if (b.theme && registry.themes.some(t => t.slug === b.theme)) patch.theme = b.theme;
          writeSettings(root, patch);
          return send(200, { ok: true, settings: readSettings(root), ...effectiveStyle(root) });
        }
      }

      if (url.pathname === '/api/ontology' && req.method === 'GET') {
        const p = logPaths(root);
        const text = existsSync(p.ontologyMd) ? readFileSync(p.ontologyMd, 'utf8') : '';
        return send(200, text, 'text/plain; charset=utf-8');
      }

      if (url.pathname === '/api/log' && req.method === 'GET') {
        const p = logPaths(root);
        const tail = Math.max(1, Math.min(500, Number(url.searchParams.get('tail') || 60)));
        const lines = existsSync(p.jsonl)
          ? readFileSync(p.jsonl, 'utf8').split('\n').filter(Boolean).slice(-tail)
          : [];
        return send(200, { paths: p, lines });
      }

      if (url.pathname === '/api/sync' && req.method === 'POST') {
        const r = syncLog(root, db);
        const p = writeOntology(root);
        return send(200, { ok: true, appended: r.appended, paths: p });
      }

      const pm = url.pathname.match(/^\/api\/projects\/(\d+)(\/[a-z]+)?$/);
      if (pm) {
        const pid = Number(pm[1]);
        const action = pm[2] ? pm[2].slice(1) : null;
        const project = getProject(db, pid);
        if (!project) return send(404, { error: '项目不存在' });

        if (req.method === 'POST' && action === 'archive') {
          const b = await body();
          const archived = b.archived === undefined ? project.status !== 'archived' : !!b.archived;
          const p = archiveProject(db, pid, archived);
          addEvent(db, null, 'project', 'ui', `项目 ${p.name} ${archived ? '已归档' : '已取消归档'}`, { project_id: pid });
          return send(200, { ok: true, project: p });
        }

        if (req.method === 'POST' && action === 'folder') {
          const { path: p } = await body();
          const folder = p ? String(p) : null;
          db.prepare('UPDATE projects SET folder = ?, updated_at = ? WHERE id = ?').run(folder, new Date().toISOString(), pid);
          addEvent(db, null, 'project', 'ui', folder ? `项目目录 → ${folder}` : '项目目录改回默认', { project_id: pid });
          return send(200, { ok: true, project: getProject(db, pid) });
        }

        if (req.method === 'POST' && action === 'open') {
          const folder = projectFolder(root, project, readConfig(root));
          const r = openFolder(folder);
          if (!r.ok) return send(500, { error: r.error });
          return send(200, { ok: true, path: folder });
        }

        if (req.method === 'POST' && action === 'restore') {
          const p = setProjectStatus(db, pid, 'active');
          return send(200, { ok: true, project: p });
        }

        if (req.method === 'DELETE' && !action) {
          const atoms = countAtoms(db, pid);
          const mode = url.searchParams.get('atoms') || 'refuse';
          if (atoms > 0 && mode === 'refuse') {
            return send(409, { error: '项目下还有原子', atoms, hint: '用 ?atoms=move&to=<项目id> 迁移，或 ?atoms=delete 一并删除' });
          }
          if (mode === 'move') {
            const to = Number(url.searchParams.get('to'));
            if (!getProject(db, to)) return send(400, { error: '目标项目不存在' });
            const moved = moveAtoms(db, pid, to);
            deleteProject(db, pid);
            return send(200, { ok: true, deleted: pid, moved });
          }
          if (mode === 'delete') {
            deleteProject(db, pid);
            return send(200, { ok: true, deleted: pid, deletedAtoms: atoms });
          }
          deleteProject(db, pid);
          return send(200, { ok: true, deleted: pid });
        }
      }

      /* ---- 项目资源：本地文件 + 得到大脑文档 ---- */
      const rm = url.pathname.match(/^\/api\/projects\/(\d+)\/resources(\/[a-z-]+)?$/);
      if (rm) {
        const pid = Number(rm[1]);
        const action = rm[2] ? rm[2].slice(1) : null;
        const project = getProject(db, pid);
        if (!project) return send(404, { error: '项目不存在' });

        if (req.method === 'GET' && !action) {
          return send(200, getProjectResources(db, root, project, cfg));
        }

        if (req.method === 'POST' && action === 'sync') {
          const b = await body().catch(() => ({}));
          try {
            const result = await syncProjectGetnote(db, root, project, cfg, { force: !!b.force });
            addEvent(db, null, 'project', 'ui',
              `项目 ${project.name} 同步得到大脑：${result.total} 篇文档`,
              { project_id: pid, kb: result.kb.name, total: result.total });
            return send(200, result);
          } catch (err) {
            return send(500, { error: err.message });
          }
        }

        if (req.method === 'POST' && action === 'kb') {
          try {
            const bound = await ensureProjectKb(db, project, { create: true });
            addEvent(db, null, 'project', 'ui',
              `项目 ${project.name} 绑定得到大脑知识库 ${bound.kb.name}`,
              { project_id: pid, topic_id: bound.kb.topic_id });
            return send(200, { ok: true, project: bound.project, kb: bound.kb });
          } catch (err) {
            return send(500, { error: err.message });
          }
        }

        if (req.method === 'GET' && action === 'kbs') {
          try {
            const topics = await listKnowledgeBases();
            return send(200, { ok: true, topics, expected: kbNameForProject(project) });
          } catch (err) {
            return send(500, { error: err.message });
          }
        }

        if (req.method === 'POST' && (action === 'open' || action === 'reveal')) {
          const b = await body();
          let target;
          try { target = resolveProjectResource(root, project, cfg, b.path); }
          catch (e) { return send(400, { error: e.message }); }
          const result = action === 'open' ? openFile(target) : revealFile(target);
          if (!result.ok) return send(500, { error: result.error });
          return send(200, { ok: true, path: target });
        }

        if (req.method === 'GET' && action === 'preview') {
          const rel = url.searchParams.get('path');
          let target;
          try { target = resolveProjectResource(root, project, cfg, rel); }
          catch (e) { return send(400, { error: e.message }); }
          try {
            const doc = readPreviewText(target, rel);
            return send(200, { ok: true, doc, project: { id: project.id, name: project.name } });
          } catch (e) {
            return send(400, { error: e.message });
          }
        }

        if (req.method === 'GET' && action === 'asset') {
          const rel = url.searchParams.get('path');
          let target;
          try { target = resolveProjectResource(root, project, cfg, rel); }
          catch (e) { return send(400, { error: e.message }); }
          const mime = assetMime(target);
          if (!mime) return send(415, { error: '该类型不支持在线预览' });
          return sendBinary(200, readFileSync(target), mime);
        }
      }

      if (url.pathname === '/api/state') return send(200, state());

      /* ---- 写作度量：字数来自真实稿件，不维护独立字数表 ---- */
      if (req.method === 'GET' && url.pathname === '/api/writing') {
        const projects = listProjects(db).filter(p => p.status !== 'archived');
        const rows = projects.map(p => {
          const s = projectWritingStats(db, root, p, cfg);
          return {
            project_id: p.id,
            project_name: p.name,
            total_words: s.total_words,
            total_goal: s.total_goal,
            atom_count: s.atom_count,
            atoms: s.atoms,
          };
        });
        return send(200, {
          ok: true,
          total_words: rows.reduce((n, r) => n + r.total_words, 0),
          total_goal: rows.reduce((n, r) => n + r.total_goal, 0),
          projects: rows,
        });
      }

      const wm = url.pathname.match(/^\/api\/projects\/(\d+)\/(writing|manuscript)(\/export)?$/);
      if (wm) {
        const pid = Number(wm[1]);
        const project = getProject(db, pid);
        if (!project) return send(404, { error: '项目不存在' });

        if (req.method === 'GET' && wm[2] === 'writing' && !wm[3]) {
          return send(200, projectWritingStats(db, root, project, cfg));
        }

        if (req.method === 'GET' && wm[2] === 'manuscript' && !wm[3]) {
          const statuses = (url.searchParams.get('statuses') || '')
            .split(',').map(s => s.trim()).filter(isStatus);
          const built = buildManuscript(db, root, project, cfg, {
            onlyStatuses: statuses.length ? statuses : null,
          });
          return send(200, {
            ok: true,
            project_id: project.id,
            project_name: project.name,
            total_words: built.total_words,
            chapters: built.chapters.map(c => ({
              atom_id: c.atom_id, title: c.title, status: c.status, words: c.words,
            })),
            markdown: built.markdown,
          });
        }

        if (req.method === 'POST' && wm[2] === 'manuscript' && wm[3]) {
          const b = await body().catch(() => ({}));
          const statuses = Array.isArray(b.statuses) ? b.statuses.filter(isStatus) : null;
          const out = exportManuscript(db, root, project, cfg, {
            onlyStatuses: statuses && statuses.length ? statuses : null,
            title: b.title ? String(b.title) : undefined,
          });
          addEvent(db, null, 'project', 'ui',
            `导出全书稿：${out.chapters.length} 章 · ${out.total_words} 字`,
            { project_id: pid, file: out.rel });
          return send(200, {
            ok: true,
            file: out.file,
            rel: out.rel,
            total_words: out.total_words,
            chapters: out.chapters.length,
          });
        }
      }

      if (url.pathname === '/api/runs' && req.method === 'GET') {
        return send(200, { runs: state().runs });
      }

      if (url.pathname === '/api/targets') return send(200, listTargets(root));

      if (url.pathname === '/api/transitions') {
        if (req.method === 'GET') return send(200, readTransitions(root));
        if (req.method === 'POST') {
          const b = await body();
          return send(200, writeTransitions(root, b));
        }
      }

      if (url.pathname === '/api/config') {
        if (req.method === 'GET') {
          const cfg = readConfig(root);
          return send(200, { config: cfg, codex: resolveCodex(cfg) });
        }
        if (req.method === 'POST') {
          const b = await body();
          saveConfig(root, b.patch || b, { scope: b.scope === 'global' ? 'global' : 'local' });
          return send(200, { ok: true, config: readConfig(root) });
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/config/test') {
        const b = await body();
        const r = await testConnection(root, { deep: b.deep !== false });
        return send(200, r);
      }

      if (url.pathname === '/api/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ type: 'state', state: state() })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/atoms') {
        const b = await body();
        const title = String(b.title || '').trim();
        if (!title) return send(400, { error: '标题不能为空' });
        const project = (b.project_id && getProject(db, b.project_id)) || listProjects(db)[0];
        if (!project) return send(400, { error: '还没有任何项目，请先新建项目' });
        const text = [String(b.body || ''), title, ...(Array.isArray(b.mentions) ? b.mentions : [])].join('\n');
        const atom = createAtom(db, {
          projectId: project.id,
          title,
          body: String(b.body || ''),
          target: String(b.target || ''),
          status: isStatus(b.status) ? b.status : 'todo',
          priority: isPriority(b.priority) ? b.priority : 'normal',
          mentions: parseMentions(text),
          workspace: b.workspace || null,
          wordGoal: Math.max(0, Number(b.word_goal ?? b.wordGoal ?? 0) || 0),
        });
        // 新建即建目录：本地立刻有一个可打开的工作文件夹
        const folder = prepareAtomFolder(root, atom, project, cfg);
        const withFolder = updateAtom(db, atom.id, { folder });
        addEvent(db, atom.id, 'created', 'ui', '从看板创建');
        return send(200, { ok: true, atom: withFolder, folder });
      }

      if (req.method === 'POST' && url.pathname === '/api/projects') {
        const b = await body();
        const name = String(b.name || '').trim();
        if (!name) return send(400, { error: '项目名不能为空' });
        const p = createProject(db, { key: b.key, name, description: String(b.description || '') });
        // 项目目录就是项目知识库：新建时立刻建好，后续所有 Atom 的 Codex 都能读它。
        const folder = ensureDir(projectFolder(root, p, cfg));
        let project = updateProject(db, p.id, { folder });
        addEvent(db, null, 'project', 'ui', `新建项目：${p.name}`, { project_id: p.id, folder });

        // 得到大脑里的同名知识库：ATOM-<项目名>。失败不阻塞建项目，只给警告。
        let warning = '';
        try {
          const bound = await ensureProjectKb(db, project);
          project = bound.project;
          addEvent(db, null, 'project', 'ui',
            `项目 ${project.name} 绑定得到大脑知识库 ${bound.kb.name}`,
            { project_id: p.id, topic_id: bound.kb.topic_id, kb: bound.kb.name });
        } catch (err) {
          warning = `得到大脑知识库 ${kbNameForProject(project)} 绑定失败：${err.message}`;
          addEvent(db, null, 'project', 'ui', warning, { project_id: p.id, level: 'warn' });
        }
        return send(200, { ok: true, project, folder, warning });
      }

      const m = url.pathname.match(/^\/api\/atoms\/([A-Za-z0-9-]+)(\/[a-z-]+)?$/);
      if (m) {
        const id = m[1];
        const action = m[2] ? m[2].slice(1) : null;
        const atom = getAtom(db, id);
        if (!atom) return send(404, { error: 'atom not found' });

        if (req.method === 'GET' && !action) {
          const events = listEvents(db, id);
          const project = getProject(db, atom.project_id);
          const folder = atomFolder(root, atom, project, cfg);
          const draft = collectDraftFiles(folder);
          return send(200, {
            atom: { ...atom, folder, words: draft.words, draft_files: draft.files },
            writing: {
              words: draft.words,
              word_goal: Number(atom.word_goal) || 0,
              files: draft.files,
              mtime: draft.mtime,
            },
            events,
            timeline: timelineDesc(buildTimeline(events)),
            links: listLinks(db, id),
            project,
            project_folder: project ? projectFolder(root, project, cfg) : null,
          });
        }

        if (req.method === 'GET' && action === 'writing') {
          const project = getProject(db, atom.project_id);
          const folder = atomFolder(root, atom, project, cfg);
          const draft = collectDraftFiles(folder);
          return send(200, {
            ok: true,
            atom_id: id,
            words: draft.words,
            word_goal: Number(atom.word_goal) || 0,
            files: draft.files,
            folder,
          });
        }

        if (req.method === 'POST' && action === 'word-goal') {
          const b = await body();
          const goal = Math.max(0, Number(b.word_goal ?? b.goal ?? 0) || 0);
          updateAtom(db, id, { word_goal: goal });
          addEvent(db, id, 'status', 'ui', goal ? `目标字数设定：${goal} 字` : '目标字数已清空', { word_goal: goal });
          return send(200, { ok: true, atom: getAtom(db, id) });
        }

        if (req.method === 'GET' && action === 'artifacts') {
          const project = getProject(db, atom.project_id);
          const folder = atomFolder(root, atom, project, cfg);
          ensureDir(folder);
          const events = listEvents(db, id);
          return send(200, {
            ok: true,
            folder,
            project_folder: project ? projectFolder(root, project, cfg) : null,
            artifacts: scanArtifacts(folder, events),
          });
        }

        if (req.method === 'POST' && (action === 'artifacts-open' || action === 'artifacts-reveal')) {
          const b = await body();
          const project = getProject(db, atom.project_id);
          const folder = atomFolder(root, atom, project, cfg);
          let target;
          try { target = resolveArtifact(folder, b.path); }
          catch (e) { return send(400, { error: e.message }); }
          const result = action === 'artifacts-open' ? openFile(target) : revealFile(target);
          if (!result.ok) return send(500, { error: result.error });
          return send(200, { ok: true, path: target });
        }

        if (req.method === 'GET' && action === 'artifacts-preview') {
          const project = getProject(db, atom.project_id);
          const folder = atomFolder(root, atom, project, cfg);
          let target;
          try { target = resolveArtifact(folder, url.searchParams.get('path')); }
          catch (e) { return send(400, { error: e.message }); }
          try {
            const doc = readPreviewText(target, url.searchParams.get('path'));
            return send(200, { ok: true, doc, atom: { id: atom.id, title: atom.title }, project: project ? { id: project.id, name: project.name } : null });
          } catch (e) {
            return send(400, { error: e.message });
          }
        }

        if (req.method === 'GET' && action === 'artifacts-asset') {
          const project = getProject(db, atom.project_id);
          const folder = atomFolder(root, atom, project, cfg);
          let target;
          try { target = resolveArtifact(folder, url.searchParams.get('path')); }
          catch (e) { return send(400, { error: e.message }); }
          const mime = assetMime(target);
          if (!mime) return send(415, { error: '该类型不支持在线预览' });
          return sendBinary(200, readFileSync(target), mime);
        }

        if (req.method === 'DELETE' && !action) {
          const deleted = deleteAtom(db, id);
          if (!deleted) return send(404, { error: 'atom not found' });
          addEvent(db, null, 'project', 'ui', `Atom ${id} 已删除：${atom.title}`, {
            action: 'atom_delete',
            atom_id: id,
            project_id: atom.project_id,
            folder: atomFolder(root, atom, getProject(db, atom.project_id), readConfig(root)),
          });
          return send(200, { ok: true, deleted: id, folder_kept: true });
        }

        if (req.method === 'POST' && action === 'move') {
          const { status } = await body();
          if (!isStatus(status)) return send(400, { error: 'bad status' });
          const from = atom.status;
          if (from === status) {
            return send(200, { ok: true, atom, rule: null, spawned: null, skipped: 'same-status' });
          }
          updateAtom(db, id, { status, progress: progressForStatus(status) });
          const r = applyTransition(db, root, id, from, status, { trigger: 'ui' });
          return send(200, {
            ok: true,
            atom: getAtom(db, id),
            rule: r.rule || null,
            spawned: r.spawned || null,
            spawn_error: r.spawned?.error || null,
            skipped: r.skipped || null,
            run: getRun(db, id),
          });
        }

        if (req.method === 'POST' && action === 'log') {
          const { message } = await body();
          if (!message) return send(400, { error: 'message required' });
          addEvent(db, id, 'note', 'ui', String(message));
          return send(200, { ok: true });
        }

        if (req.method === 'POST' && action === 'folder') {
          const { path: p } = await body();
          const folder = p ? String(p) : null;
          updateAtom(db, id, { folder });
          addEvent(db, id, 'status', 'ui', folder ? `工作目录 → ${folder}` : '工作目录改回默认', { folder });
          return send(200, { ok: true, atom: getAtom(db, id) });
        }

        if (req.method === 'POST' && action === 'open') {
          const pr = getProject(db, atom.project_id);
          const folder = atomFolder(root, atom, pr, readConfig(root));
          const r = openFolder(folder);
          if (!r.ok) return send(500, { error: r.error });
          return send(200, { ok: true, path: folder });
        }

        if (req.method === 'POST' && action === 'project') {
          const { project_id } = await body();
          const p = getProject(db, project_id);
          if (!p) return send(400, { error: '项目不存在' });
          updateAtom(db, id, { project_id: p.id });
          addEvent(db, id, 'status', 'ui', `所属项目 → ${p.name}`, { project_id: p.id });
          return send(200, { ok: true, atom: getAtom(db, id) });
        }

        if (req.method === 'POST' && action === 'target') {
          const { target } = await body();
          const next = String(target || '').trim();
          updateAtom(db, id, { target: next });
          addEvent(db, id, 'status', 'ui', next ? `目标设定：${next}` : '目标已清空', { target: next });
          return send(200, { ok: true, atom: getAtom(db, id) });
        }

        if (req.method === 'POST' && action === 'run') {
          const { workspace } = await body();
          const prev = getRun(db, id);
          if (prev && ['starting', 'running'].includes(prev.status)) {
            return send(409, { error: '该 Atom 正在执行中', run: prev });
          }
          const args = [path.join(root, 'bin', 'watomboard.mjs'), 'atom', 'run', id, '--worker'];
          if (workspace) args.push('--workspace', workspace);
          const child = spawn(process.execPath, args, {
            cwd: root, detached: true, stdio: 'ignore', windowsHide: true,
          });
          child.unref();
          addEvent(db, id, 'run_start', 'ui', '从看板触发执行');
          return send(200, { ok: true, pid: child.pid });
        }
      }

      return send(404, { error: 'not found' });
    } catch (err) {
      return send(500, { error: err.message });
    }
  });

  server.listen(port, host, () => {
    console.log(`${BRAND.name} 看板已启动 → http://${host}:${port}`);
    console.log(`数据文件: ${path.join(root, 'data', BRAND.dbFile)}`);
  });
  return server;
}
