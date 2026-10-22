import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Atom 交付物扫描。
 *
 * 交付物不是「另建一套表」，而是 Atom 工作目录里的真实文件。
 * 这里负责把文件与事件流对上：
 *   - 哪个执行体产生的（Codex / 用户 / 本地）
 *   - 在哪个环节产生的（执行阶段 / 验收对照 / 手动添加 …）
 *   - 对应哪条时间线事件
 * 这样右侧成果列表与左侧时间线天然一致。
 */

const SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', '__pycache__', '.venv', 'venv',
  '.cache', '.next', '.nuxt', '.turbo', 'dist', 'build', 'coverage',
  '.idea', '.vscode', '.DS_Store',
]);
const MAX_FILES = 800;
const MAX_DEPTH = 8;

const TYPES = {
  md: ['markdown', 'document', 'Markdown', true],
  markdown: ['markdown', 'document', 'Markdown', true],
  txt: ['text', 'document', '文本', true],
  pdf: ['pdf', 'document', 'PDF', true],
  doc: ['word', 'document', 'Word', false],
  docx: ['word', 'document', 'Word', false],
  xls: ['sheet', 'data', 'Excel', false],
  xlsx: ['sheet', 'data', 'Excel', false],
  csv: ['sheet', 'data', 'CSV', true],
  ppt: ['slides', 'document', 'PPT', false],
  pptx: ['slides', 'document', 'PPT', false],
  html: ['web', 'web', 'HTML', true],
  htm: ['web', 'web', 'HTML', true],
  css: ['code', 'code', 'CSS', true],
  js: ['code', 'code', 'JavaScript', true],
  mjs: ['code', 'code', 'JavaScript', true],
  ts: ['code', 'code', 'TypeScript', true],
  jsx: ['code', 'code', 'React', true],
  tsx: ['code', 'code', 'React', true],
  py: ['code', 'code', 'Python', true],
  ps1: ['code', 'code', 'PowerShell', true],
  sh: ['code', 'code', 'Shell', true],
  json: ['json', 'data', 'JSON', true],
  yaml: ['code', 'data', 'YAML', true],
  yml: ['code', 'data', 'YAML', true],
  zip: ['archive', 'archive', 'ZIP', false],
  rar: ['archive', 'archive', 'RAR', false],
  '7z': ['archive', 'archive', '7Z', false],
  tar: ['archive', 'archive', 'TAR', false],
  gz: ['archive', 'archive', 'GZip', false],
  png: ['image', 'image', 'PNG', true],
  jpg: ['image', 'image', 'JPEG', true],
  jpeg: ['image', 'image', 'JPEG', true],
  gif: ['image', 'image', 'GIF', true],
  webp: ['image', 'image', 'WebP', true],
  svg: ['image', 'image', 'SVG', true],
  ico: ['image', 'image', 'Icon', false],
  mp4: ['video', 'media', 'MP4', false],
  mov: ['video', 'media', 'MOV', false],
  mp3: ['audio', 'media', 'MP3', false],
  wav: ['audio', 'media', 'WAV', false],
};

export function classOf(name) {
  const ext = path.extname(String(name || '')).slice(1).toLowerCase();
  const hit = TYPES[ext];
  if (!hit) {
    return { type: ext || 'file', kind: 'other', group: 'other', label: ext ? ext.toUpperCase() : '文件', previewable: false };
  }
  const [kind, group, label, previewable] = hit;
  return { type: ext, kind, group, label, previewable };
}

const GROUPS = {
  document: '文档',
  web: '网页',
  archive: '压缩包',
  image: '图片',
  data: '数据',
  code: '代码',
  media: '媒体',
  other: '其他',
};

export function groupLabel(group) {
  return GROUPS[group] || '其他';
}

/**
 * 扫描一个 Atom 工作目录。
 * @param {string} folder 绝对路径
 * @param {Array} events 该 Atom 的事件流（listEvents 的结果）
 */
export function scanArtifacts(folder, events = []) {
  if (!folder || !existsSync(folder)) return [];

  const files = [];
  walk(folder, folder, 0, files);

  const evidence = buildEvidence(events, folder);
  const out = files.map(file => {
    const rel = toPosix(path.relative(folder, file.abs));
    const hit = evidence.byPath.get(rel)
      || evidence.byName.get(path.basename(rel).toLowerCase())
      || evidence.byTime(file.mtimeMs);
    const cls = classOf(rel);
    return {
      path: rel,
      name: path.basename(rel),
      dir: toPosix(path.dirname(rel)) === '.' ? '' : toPosix(path.dirname(rel)),
      type: cls.type,
      kind: cls.kind,
      group: cls.group,
      group_label: groupLabel(cls.group),
      label: cls.label,
      previewable: cls.previewable,
      size: file.size,
      mtime: new Date(file.mtimeMs).toISOString(),
      actor: hit?.actor || 'local',
      actor_label: actorLabel(hit?.actor || 'local'),
      stage: hit?.stage || '手动 / 本地',
      source_event_id: hit?.eventId || null,
      run_label: hit?.runLabel || '',
    };
  });

  out.sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime) || a.path.localeCompare(b.path));
  return out;
}

export function resolveArtifact(folder, rel) {
  if (!folder) throw new Error('工作目录为空');
  const root = path.resolve(folder);
  const target = path.resolve(root, String(rel || ''));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('非法文件路径');
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error('文件不存在');
  }
  return target;
}

function walk(root, dir, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name === '.gitkeep' || entry.name === 'Thumbs.db' || entry.name === 'desktop.ini') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.git')) continue;
      walk(root, abs, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const st = statSync(abs);
      out.push({ abs, size: st.size, mtimeMs: st.mtimeMs });
    } catch { /* 文件被占用时跳过 */ }
  }
}

function buildEvidence(events, folder) {
  const sorted = [...(events || [])].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || Number(a.id) - Number(b.id));
  const byPath = new Map();
  const byName = new Map();
  const windows = buildRunWindows(sorted);

  for (const event of sorted) {
    if (event.type !== 'file') continue;
    const paths = eventFiles(event);
    const stage = stageOfEvent(event, sorted);
    const hit = {
      actor: event.actor === 'codex' ? 'codex' : (event.actor === 'ui' || event.actor === 'user') ? 'user' : 'system',
      stage,
      eventId: event.id,
      runLabel: stage,
    };
    for (const raw of paths) {
      const rel = normalizeRel(raw, folder);
      if (!rel) continue;
      byPath.set(rel, hit);
      const name = path.basename(rel).toLowerCase();
      if (!byName.has(name)) byName.set(name, hit);
    }
  }

  return {
    byPath,
    byName,
    byTime(mtimeMs) {
      // 旧数据里的 file 事件可能没有路径；用事件窗口兜底。
      const hit = windows.find(w => mtimeMs >= w.start - 60_000 && mtimeMs <= w.end + 180_000);
      if (!hit) return null;
      return {
        actor: 'codex',
        stage: hit.stage,
        eventId: hit.eventId,
        runLabel: hit.stage,
      };
    },
  };
}

function buildRunWindows(events) {
  const windows = [];
  let open = null;
  for (const e of events) {
    const ts = Date.parse(e.ts);
    if (!Number.isFinite(ts)) continue;
    if (e.type === 'run_start') {
      if (!open || ts - open.start > 15_000) {
        if (open) { open.end = ts; windows.push(open); }
        open = { start: ts, end: ts, stage: '', eventId: e.id, label: '' };
      }
      const info = stageFromMessage(e.message);
      if (info.stage) {
        if (!open.stage || (!open.generic && info.generic)) {
          open.stage = info.stage;
          open.generic = info.generic;
        }
        if (!info.generic) open.label = String(e.message || '');
      }
      continue;
    }
    if (e.type === 'run_end' && open) {
      open.end = ts;
      windows.push(open);
      open = null;
    }
  }
  if (open) {
    open.end = Date.now();
    windows.push(open);
  }
  return windows
    .filter(w => w.stage)
    .map(w => ({ ...w, stage: simplifyStage(w.stage) }));
}

function stageOfEvent(event, events) {
  const idx = events.findIndex(x => x.id === event.id);
  let best = null;
  for (let i = idx - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'run_start' && e.type !== 'plan') continue;
    const info = stageFromMessage(e.message);
    if (!info.stage) continue;
    if (!best || best.generic) best = info;
    if (!info.generic) break;
  }
  return best ? simplifyStage(best.stage) : '手动 / 本地';
}

function stageFromMessage(message) {
  const msg = String(message || '').trim();
  if (!msg) return { stage: '', generic: true };
  const prep = msg.match(/启动准备流程[:：]\s*(.+)$/);
  if (prep) return { stage: prep[1].trim(), generic: false };
  const plan = msg.match(/触发准备流程[:：]\s*(.+)$/);
  if (plan) return { stage: plan[1].trim(), generic: false };
  if (/验收|交付自检/.test(msg)) return { stage: '验收阶段', generic: false };
  if (/开始执行|执行体[:：]|从看板触发执行/.test(msg)) return { stage: '执行阶段', generic: true };
  if (/准备|规划|立项|开工|确认|诊断|解阻/.test(msg)) return { stage: '准备阶段', generic: false };
  return { stage: '', generic: true };
}

function simplifyStage(stage) {
  const s = String(stage || '').trim();
  if (!s) return '执行阶段';
  if (/验收对照|交付自检/.test(s)) return '验收阶段';
  if (/立项准备|开工确认|准备/.test(s)) return s;
  return s.length > 24 ? s.slice(0, 24) + '…' : s;
}

function eventFiles(event) {
  const out = [];
  const data = event?.data || {};
  const push = value => {
    if (!value) return;
    if (Array.isArray(value)) { value.forEach(push); return; }
    for (const line of String(value).split(/\r?\n/)) {
      const s = line.trim().replace(/^["']|["']$/g, '');
      if (s) out.push(s);
    }
  };
  push(data.files);
  push(data.paths);
  push(data.path);
  push(data.file);
  if (event.type === 'file') push(event.message);
  return [...new Set(out)];
}

function normalizeRel(raw, folder) {
  const s = String(raw || '').trim().replace(/^file:\/\//i, '').replace(/\\/g, '/');
  if (!s) return '';
  const root = path.resolve(folder).replace(/\\/g, '/');
  const abs = s.match(/^[A-Za-z]:\//) ? s : null;
  if (abs) {
    const lowerRoot = root.toLowerCase();
    if (!abs.toLowerCase().startsWith(lowerRoot + '/')) return '';
    return abs.slice(root.length + 1);
  }
  if (s.startsWith('/')) return '';
  return s.replace(/^\.\//, '');
}

function actorLabel(actor) {
  if (actor === 'codex') return 'Codex';
  if (actor === 'user') return '用户';
  if (actor === 'system') return '系统';
  return '本地';
}

function toPosix(p) {
  return String(p || '').replace(/\\/g, '/');
}
