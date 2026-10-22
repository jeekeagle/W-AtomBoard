import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  openStore, createProject, listProjects, getProject, getProjectByKey,
  createAtom, listAtoms, getAtom, updateAtom, addEvent, listEvents, lastEventId,
  addLink, listLinks, removeLink, deleteAtom, slugifyKey,
  archiveProject, deleteProject, countAtoms, moveAtoms,
} from './store.mjs';
import { STATUSES, STATUS_KEYS, isStatus, isPriority, labelOf, allowedTransitions, progressForStatus } from './model.mjs';
import { parseMentions, listTargets, resolveMention } from './mentions.mjs';
import { runAtom, buildPrompt, resolveCodexBin } from './runner.mjs';
import { searchNotes, saveNote, getNote, listKbs } from './getnote.mjs';
import { renderBoard, renderAtom, renderProjects, renderAtoms } from './render.mjs';
import { effectiveStyle, writeSettings, readSettings } from './settings.mjs';
import { readConfig, saveConfig, testConnection, resolveCodex } from './config.mjs';
import { syncLog, writeOntology, logPaths } from './logbook.mjs';
import { projectFolder, atomFolder, ensureDir, openFolder, baseDir, prepareAtomFolder } from './workspaces.mjs';
import { fmtTime, fmtDateTime } from './time.mjs';
import { buildTimeline } from './timeline.mjs';
import { applyTransition, readTransitions, writeTransitions, DEFAULT_TRANSITIONS } from './transitions.mjs';
import { startServer } from './server.mjs';
import { BRAND } from './brand.mjs';
import { collectDraftFiles, projectWritingStats, exportManuscript } from './writing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DOLLAR = String.fromCharCode(36);
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const paint = (c, s) => `${C[c]}${s}${C.reset}`;

/* ---------------- arg parsing ---------------- */

/** 这些标志不带值：即使后面跟着位置参数，也不能把它吃掉 */
export const BOOLEAN_FLAGS = new Set([
  'background', 'worker', 'dry-run', 'test', 'light', 'global', 'print',
  'run-prepared',
]);

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      if (body.includes('=')) {
        const [k, ...rest] = body.split('=');
        flags[k] = rest.join('=');
      } else if (!BOOLEAN_FLAGS.has(body) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[body] = argv[++i];
      } else {
        flags[body] = true;
      }
    } else if (a.startsWith('-') && a.length > 1) {
      const body = a.slice(1);
      if (!BOOLEAN_FLAGS.has(body) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) flags[body] = argv[++i];
      else flags[body] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const flagList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/* ---------------- helpers ---------------- */

function resolveProject(db, ref) {
  if (!ref) return null;
  if (/^\\d+$/.test(String(ref))) return getProject(db, ref);
  return getProjectByKey(db, ref)
    || listProjects(db).find(p => p.name === ref)
    || listProjects(db).find(p => p.name.includes(ref));
}

function requireProject(db, ref) {
  const p = resolveProject(db, ref);
  if (!p) throw new Error(`找不到项目：${ref}`);
  return p;
}

function requireAtom(db, id) {
  const a = getAtom(db, id);
  if (!a) throw new Error(`找不到 Atom：${id}`);
  return a;
}

function nowISO() { return new Date().toISOString(); }

/* ---------------- commands ---------------- */

const commands = {};

commands.init = async ({ db, root }) => {
  console.log(paint('green', `✓ W-AtomBoard 已就绪：${path.join(root, 'data', 'watomboard.db')}`));
  console.log(paint('dim', '下一步：watomboard project add <名称>'));
};

commands.project = async ({ db, root, positional, flags }) => {
  const sub = positional[0] || 'list';
  if (sub === 'add') {
    const name = positional[1];
    if (!name) throw new Error('用法：watomboard project add <名称> [--desc 描述] [--key key]');
    const p = createProject(db, { key: flags.key, name, description: flags.desc || flags.description || '' });
    console.log(paint('green', `✓ 项目已创建 #${p.id} ${p.name} (key=${p.key})`));
  } else if (sub === 'list' || sub === 'ls') {
    const all = listProjects(db);
    const rows = flags.all ? all : all.filter(p => p.status !== 'archived');
    console.log(renderProjects(rows));
    const hidden = all.length - rows.length;
    if (hidden > 0) console.log(paint('dim', `  （另有 ${hidden} 个已归档项目，用 project list --all 查看）`));
  } else if (sub === 'archive') {
    const p = requireProject(db, positional[1]);
    archiveProject(db, p.id, true);
    addEvent(db, null, 'project', 'user', `项目 ${p.name} 已归档`, { project_id: p.id });
    console.log(paint('green', `✓ 项目已归档：${p.name}`));
  } else if (sub === 'unarchive' || sub === 'restore') {
    const p = requireProject(db, positional[1]);
    archiveProject(db, p.id, false);
    addEvent(db, null, 'project', 'user', `项目 ${p.name} 已取消归档`, { project_id: p.id });
    console.log(paint('green', `✓ 项目已恢复：${p.name}`));
  } else if (sub === 'target' || sub === 'goal') {
    const atom = requireAtom(db, positional[1]);
    const target = positional.slice(2).join(' ') || flags.target || flags.tg;
    if (target === undefined) throw new Error('用法：watomboard atom target <id> "最终要形成的结果"');
    updateAtom(db, atom.id, { target: String(target).trim() });
    addEvent(db, atom.id, 'status', 'user', target.trim() ? `目标设定：${target.trim()}` : '目标已清空', { target: String(target).trim() });
    console.log(paint('green', `✓ ${atom.id} 的目标已更新`));
  } else if (sub === 'folder' || sub === 'dir') {
    const p = requireProject(db, positional[1]);
    if (positional[2]) {
      db.prepare('UPDATE projects SET folder = ?, updated_at = ? WHERE id = ?').run(path.resolve(String(positional[2])), new Date().toISOString(), p.id);
      console.log(paint('green', `✓ 项目 ${p.name} 的目录已设为 ${positional[2]}`));
    }
    const folder = projectFolder(root, p);
    ensureDir(folder);
    console.log(`  ${p.name} 目录: ${folder}`);
  } else if (sub === 'open') {
    const p = requireProject(db, positional[1]);
    const folder = projectFolder(root, p);
    ensureDir(folder);
    const r = openFolder(folder);
    if (!r.ok) throw new Error(r.error);
    console.log(paint('green', `✓ 已打开 ${folder}`));
  } else if (sub === 'export' || sub === 'manuscript') {
    const p = requireProject(db, positional[1]);
    const statuses = flags.status ? String(flags.status).split(',').map(s => s.trim()).filter(Boolean) : null;
    const r = exportManuscript(db, root, p, readConfig(root), {
      onlyStatuses: statuses,
      title: flags.title || p.name,
    });
    console.log(paint('green', `✓ 全书稿已导出：${r.rel}`));
    console.log(paint('dim', `  ${r.chapters.length} 章 / ${r.total_words.toLocaleString('en-US')} 字`));
    console.log(paint('dim', `  ${r.file}`));
  } else if (sub === 'delete' || sub === 'rm') {
    const p = requireProject(db, positional[1]);
    const atoms = countAtoms(db, p.id);
    if (atoms > 0 && !flags.force && !flags['move-to']) {
      throw new Error(`项目 ${p.name} 下还有 ${atoms} 个原子。用 --force 一并删除，或 --move-to <项目key> 先迁移`);
    }
    if (flags['move-to']) {
      const to = requireProject(db, flags['move-to']);
      const moved = moveAtoms(db, p.id, to.id);
      deleteProject(db, p.id);
      console.log(paint('green', `✓ 项目 ${p.name} 已删除，${moved} 个原子已迁移到 ${to.name}`));
    } else {
      deleteProject(db, p.id);
      console.log(paint('green', `✓ 项目已删除：${p.name}${atoms ? '（含 ' + atoms + ' 个原子）' : ''}`));
    }
  } else {
    throw new Error(`未知子命令：project ${sub}`);
  }
};

commands.atom = async ({ db, root, positional, flags }) => {
  const sub = positional[0] || 'list';

  if (sub === 'new' || sub === 'add' || sub === 'create') {
    const projectRef = positional[1];
    const title = flags.title || flags.t;
    if (!projectRef || !title) throw new Error('用法：watomboard atom new <项目> --title "标题" [--body 描述] [--word-goal 3000] [--mention @codex]');
    const project = requireProject(db, projectRef);
    const body = flags.body || flags.b || '';
    const mentions = parseMentions([...flagList(flags.mention), ...flagList(flags.m), body, title].join('\n'));
    const wordGoal = Number(flags['word-goal'] ?? flags.words ?? flags.wg ?? 0) || 0;
    const atom = createAtom(db, {
      projectId: project.id,
      title: String(title),
      body: String(body),
      target: String(flags.target || flags.tg || ''),
      status: isStatus(flags.status) ? flags.status : 'todo',
      priority: isPriority(flags.priority) ? flags.priority : 'normal',
      mentions,
      workspace: flags.workspace || null,
      wordGoal,
    });
    const folder = prepareAtomFolder(root, atom, project, readConfig(root));
    updateAtom(db, atom.id, { folder });
    console.log(paint('green', `✓ ${atom.id} 已创建：${atom.title}`));
    console.log(paint('dim', `  工作目录：${folder}`));
    if (mentions.length) console.log(paint('dim', `  mentions: ${mentions.map(m => m.raw).join(' ')}`));
  } else if (sub === 'list' || sub === 'ls') {
    console.log(renderAtoms(listAtoms(db, { project: flags.project || flags.p, status: flags.status || flags.s })));
  } else if (sub === 'show' || sub === 'get') {
    const atom = requireAtom(db, positional[1]);
    const pr = getProject(db, atom.project_id);
    const draft = collectDraftFiles(atom.folder || atomFolder(root, atom, pr, readConfig(root)));
    console.log(renderAtom(atom, buildTimeline(listEvents(db, atom.id)), listLinks(db, atom.id), { words: draft.words, files: draft.files.length }));
  } else if (sub === 'words' || sub === 'count') {
    const atom = requireAtom(db, positional[1]);
    const pr = getProject(db, atom.project_id);
    const folder = atom.folder || atomFolder(root, atom, pr, readConfig(root));
    const draft = collectDraftFiles(folder);
    if (positional[2] !== undefined && positional[2] !== '') {
      const n = Number(positional[2]);
      if (!Number.isFinite(n) || n < 0) throw new Error('字数必须是非负数字');
      updateAtom(db, atom.id, { word_goal: Math.round(n) });
      addEvent(db, atom.id, 'note', 'user', `目标字数设为 ${Math.round(n).toLocaleString('en-US')} 字`, { word_goal: Math.round(n) });
      console.log(paint('green', `✓ ${atom.id} 目标字数 = ${Math.round(n).toLocaleString('en-US')} 字`));
    }
    const goal = Number(atom.word_goal) || 0;
    const pct = goal ? Math.min(100, Math.round((draft.words / goal) * 100)) : 0;
    console.log(`  ${atom.id} ${atom.title}`);
    console.log(`  已写 ${draft.words.toLocaleString('en-US')} 字 / 目标 ${goal ? goal.toLocaleString('en-US') : '未设'} 字${goal ? `（${pct}%）` : ''}`);
    console.log(paint('dim', `  正文文件 ${draft.files.length} 个`));
    for (const f of draft.files) console.log(paint('dim', `    ${f.path}  ${f.words} 字`));
  } else if (sub === 'stats' || sub === 'writing') {
    const project = requireProject(db, positional[1]);
    const st = projectWritingStats(db, root, project, readConfig(root));
    console.log(paint('bold', `${st.project_name} · 写作统计`));
    console.log(`  合计 ${st.total_words.toLocaleString('en-US')} 字 / 目标 ${st.total_goal ? st.total_goal.toLocaleString('en-US') : '未设'} 字`);
    for (const a of st.atoms) {
      const pct = a.word_goal ? Math.min(100, Math.round((a.words / a.word_goal) * 100)) : 0;
      console.log(`  ${a.atom_id.padEnd(7)} ${labelOf(a.status).padEnd(4)} ${a.title}  ${paint('dim', `${a.words}/${a.word_goal || '—'} 字 ${a.word_goal ? pct + '%' : ''}`)}`);
    }
  } else if (sub === 'move' || sub === 'status') {
    const atom = requireAtom(db, positional[1]);
    const to = positional[2];
    if (!isStatus(to)) throw new Error(`状态不合法：${to}（可选：${STATUS_KEYS.join(', ')}）`);
    if (atom.status !== to) {
      const from = atom.status;
      updateAtom(db, atom.id, { status: to, progress: progressForStatus(to) });
      const r = applyTransition(db, root, atom.id, from, to, { trigger: 'user' });
      console.log(paint('green', `✓ ${atom.id} → ${labelOf(to)}`));
      if (r.rule && r.rule.enabled) {
        console.log(paint('dim', `  触发准备流程：${r.rule.title || ''}` +
          ((r.rule.skills || []).length ? `  技能：${r.rule.skills.map(s => DOLLAR + s).join(' ')}` : '')));
      }
    } else {
      console.log(paint('dim', `${atom.id} 已经是 ${labelOf(to)}`));
    }
  } else if (sub === 'log' || sub === 'note') {
    const atom = requireAtom(db, positional[1]);
    const msg = positional.slice(2).join(' ') || flags.message || '';
    if (!msg) throw new Error('用法：watomboard atom log <id> <消息>');
    addEvent(db, atom.id, 'note', 'user', msg);
    console.log(paint('green', `✓ 已记录到 ${atom.id}`));
  } else if (sub === 'run' || sub === 'dispatch') {
    const atom = requireAtom(db, positional[1]);
    const depth = Number(process.env.ATOMBOARD_DEPTH || 0);
    if (depth >= 1 || process.env.ATOMBOARD_ATOM === atom.id) {
      const msg = '递归保护：执行体内部不允许再次触发 W-AtomBoard 执行（已阻止）';
      addEvent(db, atom.id, 'error', 'board', msg, { depth, parent: process.env.ATOMBOARD_ATOM || null });
      console.error(paint('red', '✗ ' + msg));
      process.exitCode = 1;
      return;
    }
    const background = !!flags.background;
    if (background) {
      const child = spawn(process.execPath, [path.join(root, 'bin', 'watomboard.mjs'), 'atom', 'run', atom.id, '--worker'], {
        cwd: root, detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
      console.log(paint('green', `✓ ${atom.id} 已在后台开始执行 (pid ${child.pid})`));
      return;
    }
    if (flags.worker) {
      await runAtom(db, atom.id, {
        root,
        workspace: flags.workspace || undefined,
        sandbox: flags.sandbox,
        prepare: flags.prepare !== undefined,
        keepStatus: flags['keep-status'] ? String(flags['keep-status']) : undefined,
        attemptBumped: !!flags['run-prepared'],
        label: flags['run-label'] ? String(flags['run-label']) : undefined,
        extraPrompt: flags.prepare ? decodeURIComponent(String(flags.prepare)) : '',
        extraSkills: flags['prepare-skills'] ? decodeURIComponent(String(flags['prepare-skills'])).split(',').map(s => s.trim()).filter(Boolean) : [],
      });
      return;
    }
    if (flags['dry-run']) {
      const resolved = (atom.mentions || []).map(m => resolveMention(root, m));
      const notes = flags.noteQuery ? await searchNotes(String(flags.noteQuery), { limit: 3 }) : [];
      console.log(resolved.map(r =>
        `@${r.name}  [${r.type}/${r.runner}]${r.skillFile ? '  skill=' + r.skillFile : ''}${r.missing ? '  ❌ 未找到该执行目标' : ''}`
      ).join('\n') || '(无 mention)');
      console.log('\n--- prompt ---\n' + buildPrompt(atom, resolved, { notes }));
      return;
    }
    const notes = flags.noteQuery ? await searchNotes(String(flags.noteQuery), { limit: 3 }) : [];
    const result = await runAtom(db, atom.id, {
      root,
      workspace: flags.workspace || undefined,
      sandbox: flags.sandbox,
      notes,
      extraPrompt: flags.prepare ? decodeURIComponent(String(flags.prepare)) : '',
      extraSkills: flags['prepare-skills'] ? decodeURIComponent(String(flags['prepare-skills'])).split(',').map(s => s.trim()).filter(Boolean) : [],
    });
    const fresh = getAtom(db, atom.id);
    console.log(renderAtom(fresh, buildTimeline(listEvents(db, atom.id)), listLinks(db, atom.id)));
    if (!result.ok) process.exitCode = 1;
  } else if (sub === 'link') {
    const atom = requireAtom(db, positional[1]);
    if (flags.note) {
      const detail = await getNote(String(flags.note));
      const title = detail?.data?.note?.title || detail?.data?.title || detail?.title || String(flags.note);
      addLink(db, atom.id, 'getnote', String(flags.note), title);
      addEvent(db, atom.id, 'link', 'user', `关联得到大脑笔记：${title}`, { noteId: flags.note });
      console.log(paint('green', `✓ ${atom.id} ↔ 笔记 ${flags.note} (${title})`));
    } else if (flags.url) {
      addLink(db, atom.id, 'url', String(flags.url), String(flags.title || ''));
      console.log(paint('green', `✓ ${atom.id} ↔ ${flags.url}`));
    } else {
      throw new Error('用法：watomboard atom link <id> --note <noteId> | --url <url>');
    }
  } else if (sub === 'unlink') {
    const atom = requireAtom(db, positional[1]);
    const n = removeLink(db, atom.id, 'getnote', String(flags.note));
    console.log(n ? paint('green', `✓ 已解除关联`) : paint('yellow', '未找到该关联'));
  } else if (sub === 'push') {
    const atom = requireAtom(db, positional[1]);
    const events = listEvents(db, atom.id);
    const output = events.filter(e => e.type === 'output').map(e => e.message).join('\n\n');
    const body = [
      `# ${atom.id} ${atom.title}`,
      '',
      `- 项目：${getProject(db, atom.project_id)?.name || ''}`,
      `- 状态：${labelOf(atom.status)}`,
      `- 创建：${fmtDateTime(atom.created_at)}`,
      '',
      '## 任务描述', atom.body || '(无)',
      '',
      '## 目标', atom.target || '(未设定)',
      '',
      '## 执行结果', output || '(无输出)',
    ].join('\n');
    const res = await saveNote({
      text: body,
      title: `[W-AtomBoard] ${atom.id} ${atom.title}`,
      tags: ['W-AtomBoard', atom.id],
    });
    const noteId = res?.data?.note?.id || res?.data?.note?.note_id || res?.data?.note_id || res?.data?.id || res?.id || '';
    if (noteId) {
      addLink(db, atom.id, 'getnote', String(noteId), `[W-AtomBoard] ${atom.title}`);
      addEvent(db, atom.id, 'getnote', 'user', `已保存到得到大脑：${noteId}`, { noteId });
    }
    console.log(paint('green', `✓ 已推送到得到大脑${noteId ? '：' + noteId : ''}`));
  } else if (sub === 'folder' || sub === 'dir') {
    const atom = requireAtom(db, positional[1]);
    if (positional[2]) {
      updateAtom(db, atom.id, { folder: path.resolve(String(positional[2])) });
      console.log(paint('green', `✓ ${atom.id} 的目录已设为 ${positional[2]}`));
    }
    const pr = getProject(db, atom.project_id);
    const folder = atom.folder || atomFolder(root, atom, pr);
    ensureDir(folder);
    console.log(`  ${atom.id} 目录: ${folder}`);
  } else if (sub === 'open') {
    const atom = requireAtom(db, positional[1]);
    const pr = getProject(db, atom.project_id);
    const folder = atom.folder || atomFolder(root, atom, pr);
    ensureDir(folder);
    const r = openFolder(folder);
    if (!r.ok) throw new Error(r.error);
    console.log(paint('green', `✓ 已打开 ${folder}`));
  } else if (sub === 'delete' || sub === 'rm') {
    const atom = requireAtom(db, positional[1]);
    deleteAtom(db, atom.id);
    console.log(paint('green', `✓ 已删除 ${atom.id}`));
  } else {
    throw new Error(`未知子命令：atom ${sub}`);
  }
};

commands.targets = async ({ db, root }) => {
  const targets = listTargets(root);
  console.log(paint('bold', '可用的 @ 执行目标：'));
  for (const t of targets) {
    console.log(`  ${paint('cyan', '@' + t.name.padEnd(18))} ${paint('dim', `[${t.type}]`)} ${t.description || ''}`);
  }
};

commands.board = async ({ db, positional, flags }) => {
  const projects = listProjects(db);
  const atoms = listAtoms(db, { project: flags.project || flags.p, status: flags.status || flags.s });
  console.log(renderBoard(projects, atoms));
};

commands.note = async ({ db, positional, flags }) => {
  const sub = positional[0] || 'search';
  if (sub === 'search') {
    const q = positional.slice(1).join(' ');
    if (!q) throw new Error('用法：watomboard note search <关键词> [--limit 5]');
    const notes = await searchNotes(q, { limit: Number(flags.limit || 5), kb: flags.kb });
    if (!notes.length) { console.log(paint('dim', '没有匹配笔记')); return; }
    for (const n of notes) {
      console.log(`${paint('cyan', n.id)} ${paint('bold', n.title)}`);
      console.log(paint('dim', '  ' + n.snippet.replace(/\s+/g, ' ').slice(0, 160)));
    }
  } else if (sub === 'show' || sub === 'get') {
    const id = positional[1];
    const d = await getNote(id);
    console.log(JSON.stringify(d, null, 2));
  } else if (sub === 'save') {
    const text = positional.slice(1).join(' ');
    const res = await saveNote({ text, title: flags.title, tags: flagList(flags.tag), topicId: flags.kb });
    console.log(paint('green', '✓ 已保存') + ' ' + JSON.stringify(res?.data?.id || res?.id || ''));
  } else if (sub === 'kbs') {
    console.log(JSON.stringify(await listKbs(), null, 2));
  } else {
    throw new Error(`未知子命令：note ${sub}`);
  }
};

commands.serve = async ({ db, root, flags }) => {
  const port = Number(flags.port || process.env.ATOMBOARD_PORT || BRAND.defaultPort);
  startServer({ db, root, port, host: flags.host || '127.0.0.1' });
  await new Promise(() => {});   // 常驻，数据库保持打开
};

commands.style = async ({ db, root, flags }) => {
  const eff = effectiveStyle(root);
  if (flags.theme) {
    const slug = String(flags.theme);
    if (!eff.themes.some(t => t.slug === slug)) {
      throw new Error(`未知主题：${slug}（可选：${eff.themes.map(t => t.slug).join(', ')}）`);
    }
    writeSettings(root, { theme: slug });
    console.log(paint('green', `✓ 默认主题已设为 ${slug}`));
    console.log(paint('dim', '  浏览器端可用导航栏右侧按钮临时切换（会记住选择）'));
    return;
  }
  if (flags.style) {
    const slug = String(flags.style);
    if (!eff.styles.some(s => s.slug === slug)) {
      throw new Error(`未知风格：${slug}（可选：${eff.styles.map(s => s.slug).join(', ')}）`);
    }
    writeSettings(root, { style: slug });
    console.log(paint('green', `✓ 默认风格已设为 ${slug}`));
    return;
  }
  const st = eff.styles.find(s => s.slug === eff.style);
  console.log(paint('bold', '当前风格与主题'));
  console.log(`  风格: ${paint('cyan', eff.style)}  ${st ? st.name : ''}`);
  console.log(`  主题: ${paint('cyan', eff.theme)}`);
  console.log(paint('dim', '  可用主题：' + eff.themes.map(t => t.slug).join(' / ')));
  console.log(paint('dim', '  用法：watomboard style --theme white | cream | ink'));
};

commands.config = async ({ db, root, flags }) => {
  if (flags.test) {
    console.log(paint('dim', '正在测试本地 Codex 连接…'));
    const r = await testConnection(root, { deep: !flags.light });
    console.log('');
    console.log(`  Codex  : ${r.codex.path || '未找到'}`);
    console.log(`  版本   : ${r.codex.version || paint('red', r.codex.error || '未知')}`);
    console.log(`  来源   : ${r.codex.source}`);
    if (r.probe) {
      console.log(`  连通探针: ${r.probe.ok ? paint('green', '通过') : paint('red', '失败')} ${r.probe.reply ? '→ ' + r.probe.reply : ''} (${(r.probe.durationMs / 1000).toFixed(1)}s)`);
      if (r.probe.error) console.log(paint('red', '    ' + r.probe.error.slice(0, 200)));
    }
    console.log(`  得到大脑: ${r.getnote.ok ? paint('green', '连通') : paint('red', r.getnote.error || '不可用')}`);
    console.log('');
    console.log(r.ok ? paint('green', '✓ 全部通过') : paint('yellow', '! 存在问题，见上'));
    if (!r.ok) process.exitCode = 1;
    return;
  }

  const patch = {};
  const codexPatch = {};
  if (flags.codex) codexPatch.bin = String(flags.codex);
  if (flags.model) codexPatch.model = String(flags.model);
  if (flags.sandbox) codexPatch.sandbox = String(flags.sandbox);
  if (flags.timeout) codexPatch.timeoutSec = Number(flags.timeout);
  if (Object.keys(codexPatch).length) patch.codex = codexPatch;
  const serverPatch = {};
  if (flags.port) serverPatch.port = Number(flags.port);
  if (flags.host) serverPatch.host = String(flags.host);
  if (Object.keys(serverPatch).length) patch.server = serverPatch;
  if (flags.kb) patch.getnote = { kb: String(flags.kb) };

  if (Object.keys(patch).length) {
    saveConfig(root, patch, { scope: flags.global ? 'global' : 'local' });
    console.log(paint('green', '✓ 配置已保存到 ' + (flags.global ? '~/.watomboard/config.json' : 'data/config.json')));
  }

  const cfg = readConfig(root);
  const bin = resolveCodex(cfg);
  console.log(paint('bold', '系统配置'));
  console.log(`  Codex 路径 : ${cfg.codex.bin || bin.cmd}${cfg.codex.bin ? '' : '  (自动定位: ' + bin.source + ')'}`);
  console.log(`  模型       : ${cfg.codex.model || '(跟随 ~/.codex/config.toml)'}`);
  console.log(`  沙箱       : ${cfg.codex.sandbox}`);
  console.log(`  超时(秒)   : ${cfg.codex.timeoutSec}`);
  console.log(`  服务端口   : ${cfg.server.host}:${cfg.server.port}`);
  console.log(`  得到大脑 KB: ${cfg.getnote.kb || '(不限定)'}`);
  console.log(paint('dim', `  修改：watomboard config --model xxx --sandbox read-only --port ${BRAND.defaultPort}`));
  console.log(paint('dim', '  测试：watomboard config --test'));
};

commands.ontology = async ({ db, root, flags }) => {
  const p = writeOntology(root);
  console.log(paint('green', '✓ 信息本体已生成'));
  console.log(`  ${p.ontologyMd}`);
  console.log(`  ${p.ontologyJson}`);
  if (flags.print) {
    console.log('');
    console.log(fs.readFileSync(p.ontologyMd, 'utf8'));
  }
};

commands.log = async ({ db, root, flags }) => {
  const r = syncLog(root, db);
  console.log(paint('dim', `已同步：新增 ${r.appended} 条事件`));
  const tail = Number(flags.tail || 30);
  const p = logPaths(root);
  if (!fs.existsSync(p.jsonl)) return;
  const lines = fs.readFileSync(p.jsonl, 'utf8').trim().split('\n').filter(Boolean);
  console.log('');
  for (const line of lines.slice(-tail)) {
    try {
      const e = JSON.parse(line);
    console.log(`  ${fmtTime(e.ts)}  ${(e.atom || '—').padEnd(6)} ${e.type.padEnd(9)} ${(e.message || '').slice(0, 90)}`);
    } catch { /* ignore */ }
  }
  console.log('');
  console.log(paint('dim', `完整日志：${p.jsonl}（机读） / ${p.md}（可读） / ${p.state}（状态快照）`));
};

commands.state = async ({ db, root }) => {
  syncLog(root, db);
  const p = logPaths(root);
  console.log(fs.readFileSync(p.state, 'utf8'));
};

commands.transitions = async ({ db, root, flags }) => {
  if (flags.from && flags.to) {
    const t = readTransitions(root);
    let rule = t.rules.find(r => r.from === flags.from && r.to === flags.to);
    if (!rule) {
      rule = { from: flags.from, to: flags.to, enabled: true, auto: false, title: '', prompt: '', skills: [] };
      t.rules.push(rule);
    }
    if (flags.prompt !== undefined) rule.prompt = String(flags.prompt);
    if (flags.skills !== undefined) rule.skills = String(flags.skills).split(',').map(s => s.trim()).filter(Boolean);
    if (flags.title !== undefined) rule.title = String(flags.title);
    if (flags.auto !== undefined) rule.auto = !!flags.auto;
    if (flags.enabled !== undefined) rule.enabled = !!flags.enabled;
    writeTransitions(root, t);
    console.log(paint('green', `✓ 规则已保存：${flags.from} → ${flags.to}`));
    console.log(paint('dim', JSON.stringify(rule, null, 2)));
    return;
  }
  const t = readTransitions(root);
  console.log(paint('bold', '状态转换规则（拖动逻辑）'));
  for (const r of t.rules) {
    const flag = r.enabled ? paint('green', '开') : paint('dim', '关');
    const auto = r.auto ? paint('cyan', '自动执行') : '';
    console.log(`  ${flag}  ${String(r.from).padEnd(12)} → ${String(r.to).padEnd(12)} ${r.title || ''} ${auto}`);
    if ((r.skills || []).length) console.log(paint('dim', `        技能：${r.skills.map(s => DOLLAR + s).join(' ')}`));
  }
  console.log('');
};

commands.doctor = async ({ db, root }) => {
  console.log(paint('bold', 'W-AtomBoard 自检'));
  console.log(`  品牌  : ${BRAND.name}（${BRAND.nameCn}）  CLI: ${BRAND.cli}`);
  console.log(`  数据库: ${path.join(root, 'data', 'watomboard.db')}`);
  console.log(`  项目数: ${listProjects(db).length}`);
  console.log(`  Atom 数: ${listAtoms(db, {}).length}`);
  const { resolveCodexBin } = await import('./runner.mjs');
  console.log(`  codex:  ${resolveCodexBin({ root }).cmd}`);
  const { resolveGetnote } = await import('./getnote.mjs');
  console.log(`  getnote: ${resolveGetnote().cmd}`);
  try {
    const notes = await searchNotes('测试', { limit: 1 });
    console.log(paint('green', `  得到大脑: 连通 (检索到 ${notes.length} 条)`));
  } catch (e) {
    console.log(paint('yellow', `  得到大脑: 不可用 - ${e.message}`));
  }
};

commands.help = async () => {
  console.log(`
${paint('bold', 'W-AtomBoard')} — 写作原子看板

${paint('bold', '项目')}
  project add <名称> [--desc 描述] [--key key]      新建项目
  project list [--all]                             列出项目（--all 含已归档）
  project folder <key> [路径]                       查看/设置项目目录
  project open <key>                                用文件管理器打开项目目录
  project export <key> [--status in_review,done] [--title 书名]   导出全书稿
  project archive <key>                           归档项目
  project unarchive <key>                         取消归档
  project delete <key> [--force] [--move-to key]   删除项目

${paint('bold', '选题 / 章节')}
  atom new <项目> --title "标题" [--body 写作要求] [--target 交付目标] [--word-goal 3000] [--mention @codex]
  atom list [--project key] [--status todo,in_progress]
  atom show <AT-1>                                 详情 + 时间线 + 字数
  atom words <AT-1> [字数]                         查看字数 / 设置目标字数
  atom stats <项目>                                项目写作统计（已写 / 目标）
  atom move <AT-1> <status> [--note 说明]          改状态
  atom log <AT-1> <消息>                            记一条事件
  atom target <AT-1> "交付目标"                     设置该选题要交付的成果
  atom run <AT-1> [--background] [--workspace 目录] [--note-query 关键词]
  atom link <AT-1> --note <笔记ID>                  关联得到大脑笔记
  atom push <AT-1>                                 把结果推送到得到大脑
  atom delete <AT-1>

${paint('bold', '其他')}
  targets                    列出可用的 @ 执行目标
  board [--project key]      文本看板
  serve [--port 7789]        启动本地看板 Web UI
  style [--theme white|cream|ink] [--style editorial]   风格与主题
  config [--test] [--model m] [--sandbox s] [--port n] [--codex 路径]   系统配置与连接测试
  transitions                                        状态转换规则（拖动逻辑）
  ontology [--print]         信息本体（所有 Agent 的入门契约）
  log [--tail N]             全局 Log
  state                      当前状态快照
  note search <关键词> [--limit 5]
  note show <笔记ID>
  note save <内容> [--title 标题] [--tag 标签]
  doctor                     自检

${paint('bold', '状态流转')}  ${STATUSES.map(s => s.key).join(' → ')}
`);
};

/* ---------------- entry ---------------- */

export async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const cmd = positional[0] || 'help';
  const root = ROOT;

  const db = openStore(root);
  try {
    const handler = commands[cmd];
    if (!handler) {
      console.error(paint('red', `未知命令：${cmd}`));
      await commands.help();
      process.exitCode = 1;
      return;
    }
    await handler({ db, root, positional: positional.slice(1), flags, argv });
  } catch (err) {
    console.error(paint('red', `✗ ${err.message}`));
    process.exitCode = 1;
  } finally {
    try { syncLog(root, db); } catch { /* 投影失败不影响主流程 */ }
    db.close?.();
  }
}
