import { STATUSES, labelOf, statusColor } from './model.mjs';
import { fmtTime, fmtDateTime } from './time.mjs';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const p = (c, s) => (useColor ? `${C[c]}${s}${C.reset}` : String(s));

const BAR = '▰▰▰▰▰▰▰▰▰▰';
function bar(pct) {
  const n = Math.max(0, Math.min(10, Math.round((pct || 0) / 10)));
  return p('green', BAR.slice(0, n)) + p('gray', BAR.slice(n));
}

export function renderProjects(projects) {
  if (!projects.length) return p('dim', '还没有项目。用 watomboard project add <名称> 建一个。');
  const lines = [];
  for (const pr of projects) {
    lines.push(`${p('cyan', pr.key.padEnd(16))} ${p('bold', pr.name)}  ${p('dim', `${pr.atom_count} 个选题 / ${pr.open_count} 未定稿`)}`);
    if (pr.description) lines.push(`  ${p('dim', pr.description)}`);
  }
  return lines.join('\n');
}

export function renderAtoms(atoms) {
  if (!atoms.length) return p('dim', '没有匹配的选题 / 章节。');
  const lines = [];
  for (const a of atoms) {
    const pr = a.priority === 'urgent' ? p('red', '!') : a.priority === 'high' ? p('yellow', '↑') : ' ';
    const st = p('cyan', labelOf(a.status).padEnd(4));
    const goal = Number(a.word_goal) || 0;
    const words = goal ? p('dim', `  目标 ${goal.toLocaleString('en-US')} 字`) : '';
    lines.push(`${pr} ${p('bold', a.id.padEnd(7))} ${st} ${a.title}${words}  ${p('dim', bar(a.progress) + ' ' + a.progress + '%')}`);
  }
  return lines.join('\n');
}

export function renderAtom(atom, events = [], links = [], writing = null) {
  const lines = [];
  lines.push(`${p('bold', atom.id)} ${atom.title}`);
  lines.push(`  状态: ${p('cyan', labelOf(atom.status))}   进度: ${bar(atom.progress)} ${atom.progress}%   优先级: ${atom.priority}`);
  const goal = Number(atom.word_goal) || 0;
  if (writing) {
    const pct = goal ? Math.min(100, Math.round((writing.words / goal) * 100)) : 0;
    lines.push(`  字数: ${p('cyan', Number(writing.words).toLocaleString('en-US'))} / ${goal ? goal.toLocaleString('en-US') : '未设目标'} 字${goal ? `（${pct}%）` : ''}${writing.files != null ? p('dim', `   正文 ${writing.files} 个文件`) : ''}`);
  } else if (goal) {
    lines.push(`  目标字数: ${p('cyan', goal.toLocaleString('en-US'))} 字`);
  }
  if (atom.mentions?.length) lines.push(`  执行体: ${atom.mentions.map(m => m.raw).join(' ')}`);
  if (atom.target) lines.push(`  目标: ${p('cyan', String(atom.target).replace(/\n/g, ' '))}`);
  if (atom.thread_id) lines.push(`  会话: ${p('dim', atom.thread_id)}`);
  if (atom.workspace) lines.push(`  工作目录: ${p('dim', atom.workspace)}`);
  lines.push(`  创建: ${p('dim', fmtDateTime(atom.created_at))}`);
  if (atom.body) {
    lines.push('');
    lines.push('  写作要求:');
    for (const l of String(atom.body).split('\n')) lines.push('    ' + l);
  }
  if (links.length) {
    lines.push('');
    lines.push('  关联:');
    for (const l of links) lines.push(`    ${l.kind === 'getnote' ? '📓' : '🔗'} ${l.kind} ${l.target}${l.title ? ' — ' + l.title : ''}`);
  }
  lines.push('');
  lines.push('  写作时间线:');
  for (const e of events) {
    const icon = { created: '✚', status: '⇄', output: '◆', plan: '☰', file: '✎', error: '✗', link: '🔗', getnote: '📓', note: '✎', run_start: '▶', run_end: '⏹', project: '▣' }[e.type] || '·';
    const brief = e.brief ? ' — ' + String(e.brief).replace(/\n/g, ' ').slice(0, 80) : '';
    const more = e.details && e.details.length ? `  (${e.details.length} 条过程细节)` : '';
    lines.push(`    ${p('dim', fmtTime(e.ts))} ${icon} ${e.title}${brief}${p('dim', more)}`);
  }
  return lines.join('\n');
}

export function renderBoard(projects, atoms) {
  const lines = [];
  for (const pr of projects) {
    const own = atoms.filter(a => Number(a.project_id) === Number(pr.id));
    if (!own.length) continue;
    const byStatus = new Map(STATUSES.map(s => [s.key, []]));
    for (const a of own) {
      if (!byStatus.has(a.status)) byStatus.set(a.status, []);
      byStatus.get(a.status).push(a);
    }
    lines.push('');
    lines.push(`${p('bold', pr.name)} ${p('dim', `(${pr.key})`)}`);
    for (const s of STATUSES) {
      const items = byStatus.get(s.key) || [];
      if (!items.length) continue;
      lines.push(`  ${p('cyan', s.label.padEnd(4))} ${items.map(a => `${a.id}`).join(' ')}`);
      for (const a of items) {
        lines.push(`        ${p('bold', a.id.padEnd(7))} ${a.title} ${p('dim', bar(a.progress) + ' ' + a.progress + '%')}`);
      }
    }
  }
  if (!lines.length) return p('dim', '看板是空的。先 watomboard project add <名称>，再 watomboard atom new ...');
  return lines.join('\n');
}
