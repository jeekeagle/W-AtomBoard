import { eventLevel, eventTitle } from './model.mjs';

/**
 * 把原始事件流投影成「以事件为中心」的时间线。
 * - milestone：占一行的时间线节点（进度信息）
 * - detail   ：过程细节，收进它所属的里程碑里，默认折叠
 * 时间线节点同时收集本次事件产生的文件，便于在展开层直接看到产出。
 */
export function buildTimeline(events) {
  const list = events || [];
  const items = [];

  for (const e of list) {
    const level = e.level || eventLevel(e.type);
    if (level === 'milestone') {
      items.push({
        id: e.id,
        ts: e.ts,
        type: e.type,
        title: eventTitle(e),
        brief: brief(e),
        details: [],
        files: collectFiles(e),
        raw: e,
      });
    } else {
      const last = items[items.length - 1];
      if (last) {
        last.details.push(e);
        last.files = unique([...(last.files || []), ...collectFiles(e)]);
      } else {
        items.push({
          id: e.id,
          ts: e.ts,
          type: 'process',
          title: '过程记录',
          brief: '',
          details: [e],
          files: collectFiles(e),
          raw: e,
        });
      }
    }
  }

  return mergeSimilar(items);
}

/**
 * 时间线的展示顺序：最新事件在上。
 * 时间戳相同则用事件 id 兜底（id 单调递增）。
 */
export function timelineDesc(items) {
  return [...(items || [])].sort((a, b) => {
    const ta = Date.parse(a?.ts) || 0;
    const tb = Date.parse(b?.ts) || 0;
    return tb - ta || Number(b?.id || 0) - Number(a?.id || 0);
  });
}

/** 合并连续的同类节点 */
function mergeSimilar(items) {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.type === it.type && MERGEABLE.has(it.type)) {
      last.count = (last.count || 1) + 1;
      last.details.push(...it.details);
      last.files = unique([...(last.files || []), ...(it.files || [])]);
      if (it.raw?.message) {
        last.raw = {
          ...last.raw,
          message: [last.raw?.message, it.raw.message].filter(Boolean).join('\n'),
        };
      }
      last.brief = it.type === 'file'
        ? `${last.files.length || countFiles(last.raw?.message)} 个文件`
        : mergeBrief(last.type, last.brief, it.brief);
      continue;
    }
    out.push({ ...it, count: 1, files: it.files || [] });
  }
  return out;
}

const MERGEABLE = new Set(['file', 'error', 'note', 'link', 'getnote', 'status']);

function mergeBrief(type, a, b) {
  if (type === 'status') return a;
  if (type === 'note' || type === 'link' || type === 'getnote') return a;
  return a || b;
}

function countFiles(text) {
  const n = String(text || '').split('\n').filter(l => l.trim()).length;
  return n || 1;
}

/** 从事件结构里提取产出文件路径 */
export function collectFiles(e) {
  const out = [];
  const push = value => {
    if (!value) return;
    for (const line of String(value).split(/\r?\n/)) {
      const s = line.trim().replace(/^["']|["']$/g, '');
      if (s) out.push(s);
    }
  };

  if (e?.type === 'file') push(e.message);
  const d = e?.data || {};
  if (Array.isArray(d.files)) d.files.forEach(push);
  else push(d.files);
  push(d.path);
  push(d.file);
  return unique(out);
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

/** 每个里程碑的一句话摘要 */
export function brief(e) {
  const msg = String(e.message || '').trim();
  switch (e.type) {
    case 'plan': {
      const todos = e.data?.todos || [];
      if (!todos.length) return firstLine(msg);
      const done = todos.filter(t => t.status === 'completed').length;
      return `${done}/${todos.length} 项完成`;
    }
    case 'output':
      return firstLine(msg, 200);
    case 'file':
      return `${collectFiles(e).length || countFiles(msg)} 个文件`;
    case 'manual':
      return firstLine(e.data?.detail || msg, 200);
    case 'input':
      return firstLine(e.data?.text || msg, 200);
    case 'status':
      return msg;
    case 'run_start':
      return msg;
    case 'run_end':
      return msg;
    case 'error':
      return firstLine(msg, 200);
    default:
      return firstLine(msg, 160);
  }
}

function firstLine(text, max = 160) {
  const line = String(text || '').split('\n').find(l => l.trim()) || '';
  return line.length > max ? line.slice(0, max) + '…' : line;
}
