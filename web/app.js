/* W-AtomBoard — Editorial style front-end */

const THEMES = [
  { slug: 'white', label: 'White' },
  { slug: 'cream', label: 'Cream' },
  { slug: 'ink',   label: 'Ink' },
];

let STATE = { projects: [], atoms: [], statuses: [], runs: [] };
let STYLE = { defaultStyle: 'editorial', defaultTheme: 'white', themes: [] };
let WRITING = { total_words: 0, total_goal: 0, projects: [] };
let current = null;
let readingRel = null;
let filter = 'all';

/* ---------- 北京时间 ---------- */
const TIME_ZONE = 'Asia/Shanghai';

function timeParts(ts) {
  if (!ts) return null;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

function fmtTime(ts) {
  const p = timeParts(ts);
  return p ? `${p.hour}:${p.minute}:${p.second}` : '';
}

function fmtDateTime(ts) {
  const p = timeParts(ts);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` : '';
}

/* ---------- 主题 ---------- */
function applyTheme(slug) {
  document.documentElement.setAttribute('data-theme', slug);
  localStorage.setItem('watomboard.theme', slug);
  const sel = document.getElementById('s-theme');
  if (sel && [...sel.options].some(o => o.value === slug)) sel.value = slug;
}

const STYLE_LABELS = { editorial: '编辑杂志风' };

function applyStyle(slug) {
  document.documentElement.setAttribute('data-style', slug);
  localStorage.setItem('watomboard.style', slug);
  const sel = document.getElementById('s-style');
  if (sel && [...sel.options].some(o => o.value === slug)) sel.value = slug;
}

function initStyle() {
  const q = new URLSearchParams(location.search).get('style');
  const saved = q || localStorage.getItem('watomboard.style');
  const available = (STYLE.styles || []).map(s => s.slug);
  const def = STYLE.style || STYLE.defaultStyle
    || (STYLE.styles && STYLE.styles[0] && STYLE.styles[0].slug) || 'editorial';
  // 本地缓存里可能残留已删除的风格，必须回落到注册表默认值。
  applyStyle(available.length && saved && !available.includes(saved) ? def : (saved || def));
}

function initTheme() {
  const saved = localStorage.getItem('watomboard.theme');
  applyTheme(saved || STYLE.defaultTheme || 'white');
}

/* ---------- 数据 ---------- */
async function loadStyle() {
  try {
    const r = await fetch('/api/style');
    STYLE = await r.json();
    initStyle();
  } catch (e) { /* 保留默认 */ }
  initTheme();
}

/** 字数来自真实稿件；单独拉取，避免 SSE 每次推送都扫盘 */
async function loadWriting() {
  try {
    const r = await fetch('/api/writing');
    if (!r.ok) return;
    WRITING = await r.json();
    const map = {};
    for (const p of WRITING.projects || []) {
      for (const a of p.atoms || []) map[a.atom_id] = a;
    }
    WORD_BY_ATOM = map;
  } catch { /* 保留上一次结果 */ }
}

let WORD_BY_ATOM = {};

function writingForAtom(id) {
  return WORD_BY_ATOM[id] || null;
}

function writingForProject(pid) {
  return (WRITING.projects || []).find(p => Number(p.project_id) === Number(pid)) || null;
}

function fmtWords(n) {
  const v = Number(n) || 0;
  return v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : v.toLocaleString('en-US');
}

async function boot() {
  if (new URLSearchParams(location.search).has('still')) document.documentElement.classList.add('still');
  await loadStyle();
  const r = await fetch('/api/state');
  STATE = await r.json();
  await loadWriting();
  render();
  const q = new URLSearchParams(location.search);
  initDrag();
  const deep = q.get('atom');
  if (deep) openDetail(deep);
  if (q.get('cfg')) openSettings(q.get('tab') || 'codex');
  if (q.get('new')) openModal();
  const es = new EventSource('/api/stream');
  es.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') {
      STATE = m.state;
      render();
      scheduleWritingReload();
      if (current) openDetail(current, true);
    }
  };
}

let writingTimer = null;
function scheduleWritingReload() {
  clearTimeout(writingTimer);
  writingTimer = setTimeout(async () => {
    await loadWriting();
    render();
  }, 1200);
}

/* ---------- 渲染 ---------- */
function projectOf(id) { return STATE.projects.find(p => p.id === id); }

function render() {
  renderFilters();
  const board = document.getElementById('board-inner');
  const atoms = STATE.atoms.filter(a => filter === 'all' || String(a.project_id) === filter);

  const ADDABLE = ['idea', 'todo', 'in_progress'];
  const cols = STATE.statuses;
  const targetProject = filter !== 'all' ? filter : (STATE.projects[0] && STATE.projects[0].id);
  board.innerHTML = cols.map(s => {
    const items = atoms.filter(a => a.status === s.key);
    const add = ADDABLE.includes(s.key)
      ? `<button class="col-add" title="在此状态新建 Atom" onclick="quickAdd('${targetProject}','${s.key}')">+</button>`
      : '';
    return `<section class="col" data-status="${s.key}">
      <div class="col-head"><span class="col-title">${esc(s.label)}</span><span class="col-count">${String(items.length).padStart(2, '0')}</span>${add}</div>
      <div class="cards">${items.length ? items.map(card).join('') : '<div class="empty">空</div>'}</div>
    </section>`;
  }).join('');

  const writing = filter === 'all'
    ? { total_words: WRITING.total_words || 0, total_goal: WRITING.total_goal || 0 }
    : (writingForProject(filter) || { total_words: 0, total_goal: 0 });
  const rate = writing.total_goal ? Math.min(100, Math.round(writing.total_words / writing.total_goal * 100)) : null;
  const open = STATE.atoms.filter(a => ['in_progress', 'blocked'].includes(a.status)).length;
  const total = STATE.atoms.length;
  const n = v => String(v).padStart(2, '0');
  document.getElementById('figures').innerHTML =
    `<div><b>${fmtWords(writing.total_words)}</b><span>已写字数</span></div>
     <div><b>${writing.total_goal ? fmtWords(writing.total_goal) : '—'}</b><span>目标字数</span></div>
     <div><b>${rate === null ? '—' : rate + '%'}</b><span>完成度</span></div>
     <div><b>${n(total)}</b><span>选题 / 章节</span></div>
     <div><b>${n(open)}</b><span>写作中</span></div>`;
  document.getElementById('subtitle').textContent = '一个 Atom 是一个选题或章节：交给 Codex 写，稿件落盘，字数回流。';
  renderProgress();
}

/* ---------- 进度状态抽屉 ---------- */
const RUN_LABELS = {
  starting: '正启动',
  running: '正执行',
  failed: '失败',
  done: '已完成',
  idle: '空闲',
};

function isActiveRun(run) {
  return run && ['starting', 'running'].includes(run.status);
}

function renderProgress() {
  const fab = document.getElementById('progress-fab');
  const count = document.getElementById('progress-fab-count');
  const summary = document.getElementById('progress-summary');
  const list = document.getElementById('progress-list');
  if (!fab || !count || !summary || !list) return;

  const runs = Array.isArray(STATE.runs) ? STATE.runs : [];
  const active = runs.filter(isActiveRun);
  const failed = runs.filter(r => r.status === 'failed');
  const done = runs.filter(r => r.status === 'done');

  fab.classList.toggle('live', active.length > 0);
  fab.classList.toggle('problem', active.length === 0 && failed.length > 0);
  count.textContent = String(active.length || failed.length || 0);
  fab.title = active.length
    ? `${active.length} 个执行体正在运行`
    : failed.length
      ? `${failed.length} 个执行失败`
      : '当前没有执行中的任务';

  summary.innerHTML = `
    <span class="progress-chip">正执行 <b>${active.length}</b></span>
    <span class="progress-chip">失败 <b>${failed.length}</b></span>
    <span class="progress-chip">已完成 <b>${done.length}</b></span>`;

  if (!runs.length) {
    list.innerHTML = '<p class="progress-empty">还没有 Codex 执行记录</p>';
    return;
  }

  list.innerHTML = runs.map(r => {
    const status = RUN_LABELS[r.status] ? r.status : 'idle';
    const label = RUN_LABELS[status];
    const when = fmtDateTime(r.last_activity || r.updated_at);
    return `<article class="run-item" data-atom="${esc(r.atom_id)}" role="button" tabindex="0">
      <span class="run-top">
        <span class="run-id">${esc(r.atom_id)}</span>
        <span class="run-title">${esc(r.title || '（已删除）')}</span>
        <span class="run-badge ${status}">${label}</span>
      </span>
      <span class="run-msg">${esc(r.message || '等待新的执行活动…')}</span>
      ${r.error ? `<span class="run-err">${esc(r.error)}</span>` : ''}
      <span class="run-meta">
        <span>第 <b>${Number(r.attempt) || 0}</b> 次</span>
        ${when ? `<span>${esc(when)}</span>` : ''}
        ${r.label ? `<span>${esc(r.label)}</span>` : ''}
      </span>
    </article>`;
  }).join('');
}

function setProgressOpen(open) {
  const drawer = document.getElementById('progress-drawer');
  const fab = document.getElementById('progress-fab');
  if (!drawer || !fab) return;
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  fab.setAttribute('aria-expanded', String(open));
}

function bindProgressUi() {
  const fab = document.getElementById('progress-fab');
  const dock = document.getElementById('progress-dock');
  const pin = document.getElementById('progress-fab-pin');
  const close = document.getElementById('progress-close');
  const list = document.getElementById('progress-list');
  if (!fab) return;

  // 贴边折叠：默认收起标签，hover 展开；可钉住常驻展开
  const PIN_KEY = 'watomboard.progress.pinned';
  const applyPinned = on => {
    if (!dock) return;
    dock.classList.toggle('pinned', !!on);
    if (pin) pin.setAttribute('aria-pressed', String(!!on));
  };
  applyPinned(localStorage.getItem(PIN_KEY) === '1');
  if (pin) {
    pin.addEventListener('click', e => {
      e.stopPropagation();
      const on = !dock.classList.contains('pinned');
      applyPinned(on);
      localStorage.setItem(PIN_KEY, on ? '1' : '0');
    });
  }

  fab.addEventListener('click', () => {
    setProgressOpen(fab.getAttribute('aria-expanded') !== 'true');
  });
  if (close) close.addEventListener('click', () => setProgressOpen(false));

  document.addEventListener('pointerdown', e => {
    const drawer = document.getElementById('progress-drawer');
    if (!drawer || !drawer.classList.contains('open')) return;
    if (drawer.contains(e.target) || fab.contains(e.target)) return;
    setProgressOpen(false);
  });

  if (list) {
    const openRun = target => {
      const item = target.closest('[data-atom]');
      if (!item) return;
      const id = item.getAttribute('data-atom');
      if (!STATE.atoms.some(a => a.id === id)) return;
      setProgressOpen(false);
      openDetail(id);
    };
    list.addEventListener('click', e => openRun(e.target));
    list.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openRun(e.target);
      }
    });
  }
}

bindProgressUi();

function renderFilters() {
  const box = document.getElementById('filters');
  const all = STATE.atoms.length;
  box.innerHTML =
    `<button data-p="all" aria-pressed="${filter === 'all'}">全部<span class="count">${all}</span></button>` +
    STATE.projects.map(p => {
      const n = STATE.atoms.filter(a => Number(a.project_id) === Number(p.id)).length;
      const arch = p.status === 'archived' ? ' · 归档' : '';
      return `<button data-p="${p.id}" aria-pressed="${filter === String(p.id)}"${p.status === 'archived' ? ' style="opacity:.6"' : ''}>${esc(p.name)}${arch}<span class="count">${n}</span></button>`;
    }).join('') +
    `<button data-p="__new" id="filter-new">新建项目</button>`;
  box.querySelectorAll('button[data-p]').forEach(b => {
    b.addEventListener('click', () => {
      const p = b.dataset.p;
      if (p === '__new') return newProjectPrompt();
      filter = p;
      render();
    });
  });
  // 「查看项目资源」：先选中一个项目，再点它。
  const resBtn = document.createElement('button');
  resBtn.id = 'project-resources-open';
  resBtn.className = 'filter-res';
  const selected = STATE.projects.find(p => String(p.id) === filter);
  resBtn.disabled = !selected;
  resBtn.textContent = selected ? `资源：${selected.name}` : '查看项目资源';
  resBtn.title = selected ? `查看「${selected.name}」的全部资源` : '先在左侧选中一个项目';
  resBtn.addEventListener('click', () => { if (selected) openProjectResources(selected.id); });
  box.appendChild(resBtn);
}

async function newProjectPrompt() {
  const name = window.prompt('新建项目名称');
  if (!name || !name.trim()) return;
  const r = await fetch('/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  });
  const d = await r.json();
  if (d.ok) {
    filter = 'all';
    await refresh();
    if (d.warning) toast(d.warning, 'warn');
  } else {
    toast('新建项目失败：' + (d.error || '未知错误'), 'error');
  }
}

/* ---------- 项目资源抽屉：本地文件 + 得到大脑文档 ---------- */
let resourceProjectId = null;

async function openProjectResources(pid) {
  resourceProjectId = Number(pid);
  const drawer = document.getElementById('resource-drawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.getElementById('scrim').classList.add('open');
  document.body.classList.add('drawer-open');
  await loadProjectResources();
}

function closeProjectResources() {
  const drawer = document.getElementById('resource-drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  if (!document.getElementById('drawer').classList.contains('open')) {
    document.getElementById('scrim').classList.remove('open');
    document.body.classList.remove('drawer-open');
  }
  resourceProjectId = null;
}

async function loadProjectResources() {
  if (!resourceProjectId) return;
  const status = document.getElementById('r-status');
  status.textContent = '正在读取项目资源…';
  const r = await fetch('/api/projects/' + resourceProjectId + '/resources');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    status.textContent = '读取失败：' + (d.error || '未知错误');
    return;
  }
  const p = d.project || {};
  let w = { total_words: 0, total_goal: 0, atom_count: 0 };
  try {
    const wr = await fetch('/api/projects/' + resourceProjectId + '/writing');
    if (wr.ok) w = await wr.json();
  } catch { /* 字数不是关键路径 */ }
  document.getElementById('r-title').textContent = p.name || '项目资源';
  document.getElementById('r-meta').innerHTML =
    `<span class="res-chip">知识库 <b>${esc(d.kb_name || '')}</b></span>` +
    `<span class="res-chip">topic_id <b>${esc(d.kb_topic_id || '未绑定')}</b></span>` +
    `<span class="res-chip">目录 <b>${esc(d.folder || '')}</b></span>` +
    `<span class="res-chip">字数 <b>${fmtWords(w.total_words)}</b>${w.total_goal ? ' / ' + fmtWords(w.total_goal) : ''}</span>` +
    `<span class="res-chip">最近同步 <b>${esc(fmtDateTime(d.kb_synced_at) || '从未')}</b></span>`;

  const local = d.local || [];
  const getnote = d.getnote || [];
  document.getElementById('r-local-count').textContent = `${local.length} 个文件`;
  document.getElementById('r-getnote-count').textContent = `${getnote.length} 篇文档`;

  document.getElementById('r-local').innerHTML = local.length
    ? local.map(f => `<div class="res-row" data-rel="${esc(f.path)}" data-atom="${esc(f.atom_id || '')}" data-atom-path="${esc(f.atom_path || '')}">
        <span class="res-icon">${esc(f.label || '文件')}</span>
        <span class="res-main">
          <span class="res-name" title="${esc(f.path)}">${esc(f.name)}</span>
          <span class="res-sub">${esc(f.atom_id || '')} · ${esc(f.actor_label || '本地')} · ${esc(f.stage || '')} · ${esc(fmtDateTime(f.mtime) || '')}</span>
        </span>
        <span class="res-ops">
          ${isReadableArtifact(f) ? '<button class="btn ghost" data-op="read">阅读</button>' : ''}
          <button class="btn ghost" data-op="open">打开</button>
          <button class="btn ghost" data-op="reveal">定位</button>
        </span>
      </div>`).join('')
    : '<p class="res-empty">该项目下还没有本地文件。</p>';

  document.getElementById('r-getnote').innerHTML = getnote.length
    ? getnote.map(doc => `<div class="res-row" data-rel="${esc(doc.path)}" data-atom="" data-atom-path="">
        <span class="res-icon">笔记</span>
        <span class="res-main">
          <span class="res-name" title="${esc(doc.title)}">${esc(doc.title)}</span>
          <span class="res-sub">${esc(doc.note_id || '')} · ${esc(doc.updated_at || '')}</span>
        </span>
        <span class="res-ops">
          <button class="btn ghost" data-op="read">阅读</button>
          <button class="btn ghost" data-op="open">打开</button>
          <button class="btn ghost" data-op="reveal">定位</button>
        </span>
      </div>`).join('')
    : `<p class="res-empty">还没有同步到本地。点击「同步得到大脑」把知识库 <b>${esc(d.kb_name || '')}</b> 的文档拉到项目目录。</p>`;

  status.textContent = '';
}

async function syncProjectResources() {
  if (!resourceProjectId) return;
  const btn = document.getElementById('r-sync');
  const status = document.getElementById('r-status');
  btn.disabled = true;
  btn.textContent = '同步中…';
  status.textContent = '正在从得到大脑拉取知识库文档…';
  try {
    const r = await fetch('/api/projects/' + resourceProjectId + '/resources/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || '同步失败');
    status.textContent = d.warnings && d.warnings.length
      ? `已同步 ${d.total} 篇文档（${d.warnings.length} 条警告）`
      : `已同步 ${d.total} 篇文档到项目目录`;
    if (d.warnings && d.warnings.length) console.warn(d.warnings);
    await loadProjectResources();
    await refresh();
  } catch (err) {
    status.textContent = '同步失败：' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '同步得到大脑';
  }
}

async function openProjectResourceFile(rel, op) {
  if (!resourceProjectId) return;
  const r = await fetch('/api/projects/' + resourceProjectId + '/resources/' + op, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: rel }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { toast('操作失败：' + (d.error || '未知错误'), 'error'); return; }
}

function runOf(id) {
  return (STATE.runs || []).find(r => r.atom_id === id) || null;
}

/**
 * 卡片右上角的实时状态：执行态优先，其次回落到工作流状态。
 * 拖动改变状态后，即使没有 Codex run，也能立刻看到「待办 / 正执行 / 待验收 / 已完成」。
 */
function runBadgeState(atom, run) {
  if (run?.status === 'failed') return { key: 'failed', label: '失败' };
  if (run?.status === 'starting') return { key: 'starting', label: '正启动' };
  if (run?.status === 'running') {
    const text = `${run.phase || ''} ${run.label || ''} ${run.message || ''}`;
    if (/构思|准备|诊断|立项|选题|分析|解阻|提纲/.test(text)) return { key: 'planning', label: '正构思' };
    return { key: 'running', label: '正写作' };
  }
  const status = atom?.status;
  if (status === 'blocked') return { key: 'blocked', label: '卡文' };
  if (status === 'in_review') return { key: 'review', label: '待审校' };
  if (status === 'done') return { key: 'done', label: '已定稿' };
  if (status === 'in_progress') return { key: 'progress', label: '写作中' };
  if (status === 'todo') return { key: 'todo', label: '待写' };
  if (status === 'idea') return { key: 'idea', label: '灵感' };
  return null;
}

let toastTimer = null;
function toast(message, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = `toast ${kind}`; }, 3200);
}

function card(a) {
  const p = projectOf(a.project_id);
  const ms = (a.mentions || []).map(m => `<span class="tag">@${esc(m.name)}</span>`).join(' ');
  const run = runOf(a.id);
  const state = runBadgeState(a, run);
  const badge = state
    ? `<span class="card-run ${esc(state.key)}">${esc(state.label)}</span>`
    : '';
  const w = writingForAtom(a.id);
  const words = w ? Number(w.words) || 0 : (Number(a.words) || 0);
  const goal = Number(a.word_goal) || (w ? Number(w.word_goal) : 0) || 0;
  const pct = goal ? Math.min(100, Math.round(words / goal * 100)) : null;
  const wordLine = goal
    ? `<span class="card-words" title="${words} / ${goal} 字">${fmtWords(words)} / ${fmtWords(goal)} 字</span>`
    : (words ? `<span class="card-words" title="${words} 字">${fmtWords(words)} 字</span>` : '');
  const wordBar = goal
    ? `<div class="rule word-rule" title="${pct}%"><i style="width:${pct}%"></i></div>`
    : '';
  return `<article class="card" draggable="true" data-id="${a.id}" onclick="openDetail('${a.id}')">
    <div class="card-id">${esc(a.id)}${badge}</div>
    <div class="card-title">${esc(a.title)}</div>
    ${a.target ? `<div class="card-target" title="${esc(a.target)}">${esc(a.target)}</div>` : ''}
    <div class="card-meta">
      ${p ? `<span>${esc(p.name)}</span><span class="sep">/</span>` : ''}
      <span>${esc(a.priority)}</span>
      ${ms ? `<span class="sep">/</span>${ms}` : ''}
      ${wordLine ? `<span class="sep">/</span>${wordLine}` : ''}
      <button class="card-folder" title="${esc(a.folder || '')}" onclick="event.stopPropagation();openAtomFolder('${a.id}')">目录</button>
    </div>
    <div class="rule"><i style="width:${a.progress || 0}%"></i></div>
    ${wordBar}
  </article>`;
}

/* ---------- 原生拖拽：卡片横向拖到别的列 = 改状态 ---------- */
function initDrag() {
  const board = document.getElementById('board-inner');
  let dragId = null;
  let moved = false;

  board.addEventListener('dragstart', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    dragId = card.dataset.id;
    moved = false;
    card.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch { /* ignore */ }
    }
  });

  board.addEventListener('dragover', e => {
    const col = e.target.closest('.col');
    if (!col || !dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    board.querySelectorAll('.col.drop-target').forEach(c => { if (c !== col) c.classList.remove('drop-target'); });
    col.classList.add('drop-target');
  });

  board.addEventListener('dragleave', e => {
    const col = e.target.closest('.col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop-target');
  });

  board.addEventListener('drop', async e => {
    const col = e.target.closest('.col');
    if (!col || !dragId) return;
    e.preventDefault();
    const id = dragId;
    const status = col.dataset.status;
    col.classList.remove('drop-target');
    dragId = null;
    moved = true;
    setTimeout(() => { moved = false; }, 250);
    const atom = STATE.atoms.find(a => a.id === id);
    if (!atom || atom.status === status || !status) return;
    const res = await fetch('/api/atoms/' + id + '/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast('移动失败：' + (data.error || '未知错误'), 'error');
      await refresh();
      return;
    }
    if (data.spawn_error) {
      toast('已改变状态，但准备流程启动失败：' + data.spawn_error, 'error');
    } else if (data.skipped === 'already-running') {
      toast('已改变状态：该原子已有执行体在运行，未重复启动', 'warn');
    } else if (data.spawned) {
      toast('已触发准备流程，正在启动 Codex…', 'ok');
      setProgressOpen(true);
    } else if (data.rule && data.rule.enabled) {
      toast('已改变状态：' + (data.rule.title || '命中规则'), 'ok');
    } else {
      toast('已改变状态', 'ok');
    }
    await refresh();
  });

  board.addEventListener('dragend', () => {
    board.querySelectorAll('.dragging').forEach(c => c.classList.remove('dragging'));
    board.querySelectorAll('.col.drop-target').forEach(c => c.classList.remove('drop-target'));
    dragId = null;
    setTimeout(() => { moved = false; }, 250);
  });

  // 拖完不要立刻弹抽屉
  board.addEventListener('click', e => {
    if (moved) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

/* ---------- 打开工作目录 ---------- */
async function openAtomFolder(id) {
  const r = await fetch('/api/atoms/' + id + '/open', { method: 'POST' });
  const d = await r.json();
  if (!r.ok) { alert('打开失败：' + (d.error || '未知错误')); return; }
  await refresh();
}

/* ---------- 项目管理 ---------- */
let projDeleteId = null;

function renderProjList() {
  const box = document.getElementById('proj-list');
  if (!box) return;
  box.innerHTML = STATE.projects.map(p => {
    const atoms = STATE.atoms.filter(a => Number(a.project_id) === Number(p.id)).length;
    const archived = p.status === 'archived';
    const confirming = projDeleteId === p.id;
    const others = STATE.projects.filter(x => x.id !== p.id);
    const row = `<div class="proj-row ${archived ? 'archived' : ''}" data-p="${p.id}">
      <div class="proj-info">
        <div class="proj-name">${esc(p.name)}<span class="proj-state ${archived ? '' : 'on'}">${archived ? '已归档' : '活跃'}</span></div>
        <div class="proj-key">${esc(p.key)} · ${atoms} 个原子</div>
      </div>
      <div class="proj-ops">
        <button class="btn ghost" data-act="folder">目录</button>
        <button class="btn ghost" data-act="toggle">${archived ? '恢复' : '归档'}</button>
        <button class="btn ghost" data-act="del">删除</button>
      </div>
    </div>`;
    const confirm = confirming ? `<div class="proj-confirm" data-p="${p.id}">
      <span>${atoms > 0 ? `该项目下有 ${atoms} 个原子。` : '确定删除该项目？'}</span>
      ${atoms > 0 ? `<select data-role="target">${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>` : ''}
      ${atoms > 0 ? '<button class="btn" data-act="move">迁移并删除</button><button class="btn ghost" data-act="wipe">一并删除</button>' : '<button class="btn" data-act="wipe">删除</button>'}
      <button class="btn ghost" data-act="cancel">取消</button>
    </div>` : '';
    return row + confirm;
  }).join('');

  box.querySelectorAll('[data-act]').forEach(btn => {
    const act = btn.dataset.act;
    const row = btn.closest('[data-p]');
    const pid = Number(row.dataset.p);
    if (act === 'toggle') {
      btn.addEventListener('click', async () => {
        const p = STATE.projects.find(x => x.id === pid);
        await fetch('/api/projects/' + pid + '/archive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: !(p && p.status === 'archived') })
        });
        await refresh(); renderProjList();
      });
    } else if (act === 'folder') {
      btn.addEventListener('click', async () => {
        const r = await fetch('/api/projects/' + pid + '/open', { method: 'POST' });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          alert('打开失败：' + (d.error || '未知错误'));
        }
      });
    } else if (act === 'del') {
      btn.addEventListener('click', () => { projDeleteId = pid; renderProjList(); });
    } else if (act === 'cancel') {
      btn.addEventListener('click', () => { projDeleteId = null; renderProjList(); });
    } else if (act === 'move') {
      btn.addEventListener('click', async () => {
        const sel = row.querySelector('[data-role="target"]');
        const to = sel ? sel.value : '';
        if (!to) return;
        await fetch('/api/projects/' + pid + '?atoms=move&to=' + to, { method: 'DELETE' });
        projDeleteId = null;
        await refresh(); renderProjList();
      });
    } else if (act === 'wipe') {
      btn.addEventListener('click', async () => {
        const atoms = STATE.atoms.filter(a => Number(a.project_id) === pid).length;
        if (atoms > 0 && !window.confirm(`将同时删除 ${atoms} 个原子，且不可恢复。确定？`)) return;
        await fetch('/api/projects/' + pid + '?atoms=delete', { method: 'DELETE' });
        projDeleteId = null;
        await refresh(); renderProjList();
      });
    }
  });
}

/* ---------- 抽屉 ---------- */
async function openDetail(id, keepScroll) {
  const r = await fetch('/api/atoms/' + id);
  const d = await r.json();
  current = id;

  const switching = current !== id;
  if (switching) resetReader();
  renderReaderOverview(d.atom, d.project);

  document.getElementById('d-cid').textContent = `${d.atom.id} · ${d.project ? d.project.name : ''}`;
  document.getElementById('d-title').textContent = d.atom.title;
  document.getElementById('d-body').textContent = d.atom.body || '（无）';
  document.getElementById('d-target').value = d.atom.target || '';
  document.getElementById('d-word-goal').value = d.atom.word_goal || '';

  const w = d.writing || { words: 0, word_goal: 0, files: [] };
  const goal = Number(w.word_goal) || 0;
  const words = Number(w.words) || 0;
  const pct = goal ? Math.min(100, Math.round(words / goal * 100)) : 0;
  document.getElementById('d-words').innerHTML =
    `<div class="word-line"><b>${fmtWords(words)}</b> 字` +
    `${goal ? ` <span class="word-sep">/</span> 目标 ${fmtWords(goal)} 字` : ' <span class="hint">未设目标</span>'}` +
    `<span class="word-files">${(w.files || []).length} 个稿件文件</span></div>` +
    (goal ? `<div class="rule word-rule"><i style="width:${pct}%"></i></div>` : '');

  const ms = (d.atom.mentions || []).map(m => `<span class="tag">@${esc(m.name)}</span>`).join(' ');
  const meta = document.getElementById('d-meta');
  meta.dataset.status = d.atom.status;
  document.getElementById('d-meta-extra').innerHTML =
    `<span>${fmtWords(words)} 字${goal ? ` / ${fmtWords(goal)}` : ''}</span>` +
    `${ms ? '<span class="sep">/</span>' + ms : ''}`;

  document.getElementById('d-folder').innerHTML =
    `<span class="folder-path">${esc(d.atom.folder || '')}</span>`;

  document.getElementById('d-links').innerHTML = d.links.length
    ? d.links.map(l => `<span class="tag" style="margin:0 8px 8px 0">${l.kind === 'getnote' ? '笔记' : '链接'} ${esc(l.target)} ${esc(l.title || '')}</span>`).join('')
    : '<span class="hint">无关联</span>';

  renderTimeline(d.timeline || d.events);

  const psel = document.getElementById('d-project');
  psel.innerHTML = STATE.projects.map(p =>
    `<option value="${p.id}"${Number(p.id) === Number(d.atom.project_id) ? ' selected' : ''}>${esc(p.name)}</option>`
  ).join('');

  const sel = document.getElementById('d-status');
  if (!sel.options.length) {
    sel.innerHTML = STATE.statuses.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
  }
  sel.value = d.atom.status;

  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
  document.getElementById('resource-drawer').classList.remove('open');
  document.getElementById('resource-drawer').setAttribute('aria-hidden', 'true');
  document.getElementById('scrim').classList.add('open');
  loadAtomArtifacts(id);
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer').setAttribute('aria-hidden', 'true');
  document.getElementById('scrim').classList.remove('open');
  if (!document.getElementById('resource-drawer').classList.contains('open')) {
    document.body.classList.remove('drawer-open');
  }
  current = null;
}

/* ---------- Atom 成果：右侧成果列表 ---------- */
/* 可进入阅读页的文本类成果 */
const READABLE_EXTS = ['md', 'markdown', 'txt', 'csv', 'json', 'yaml', 'yml',
  'js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'ps1', 'sh', 'css'];

function isReadableArtifact(f) {
  const name = String((f && f.name) || '');
  const ext = String((f && (f.type || f.ext)) || '').toLowerCase()
    || (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
  return READABLE_EXTS.includes(ext);
}

function openReader(scope, id, rel) {
  const u = `/preview?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}` +
    `&path=${encodeURIComponent(rel)}`;
  const w = window.open(u, '_blank', 'noopener');
  if (!w) location.href = u;
}

/* ---------- 中间阅读区（内嵌，不离开看板） ---------- */
function renderReaderOverview(atom, project) {
  const box = document.getElementById('d-reader-overview');
  if (!box) return;
  const target = (atom.target || '').trim() || '还没有设定目标。';
  box.innerHTML =
    `<p class="reader-kicker">Work Brief · ${esc(atom.id)}</p>` +
    `<h3>${esc(atom.title)}</h3>` +
    `<div class="reader-meta">` +
      `<span><b>状态</b>${esc(statusLabel(atom.status))}</span>` +
      `<span><b>项目</b>${esc(project ? project.name : '未归属')}</span>` +
      `<span><b>字数</b>${fmtWords(atom.words || 0)}${atom.word_goal ? ' / ' + fmtWords(atom.word_goal) : ''}</span>` +
      `<span><b>进度</b>${Number(atom.progress) || 0}%</span>` +
    `</div>` +
    `<p class="reader-lead">${esc(atom.body || '还没有描述。')}</p>` +
    `<div class="reader-target"><span>目标 Target</span><p>${esc(target)}</p></div>` +
    `<p class="reader-hint">右侧「成果」中点击「阅读」，Markdown 会直接在这里打开，不会离开看板。</p>`;
}

function resetReader() {
  const frame = document.getElementById('d-reader-frame');
  const overview = document.getElementById('d-reader-overview');
  const clear = document.getElementById('d-reader-clear');
  const pathEl = document.getElementById('d-reader-path');
  if (frame) { frame.src = 'about:blank'; frame.hidden = true; }
  if (overview) overview.hidden = false;
  if (clear) clear.hidden = true;
  if (pathEl) { pathEl.textContent = '工作说明'; pathEl.title = '工作说明'; }
  readingRel = null;
  document.querySelectorAll('#d-artifacts .res-row.reading')
    .forEach(row => row.classList.remove('reading'));
}

function openInlineReader(rel) {
  if (!current) return;
  const frame = document.getElementById('d-reader-frame');
  const overview = document.getElementById('d-reader-overview');
  const clear = document.getElementById('d-reader-clear');
  const pathEl = document.getElementById('d-reader-path');
  if (!frame || !overview) return;
  frame.src = `/preview?scope=atom&id=${encodeURIComponent(current)}` +
    `&path=${encodeURIComponent(rel)}&embed=1`;
  frame.hidden = false;
  overview.hidden = true;
  if (clear) clear.hidden = false;
  if (pathEl) { pathEl.textContent = baseName(rel); pathEl.title = rel; }
  readingRel = rel;
  document.querySelectorAll('#d-artifacts .res-row').forEach(row => {
    row.classList.toggle('reading', row.dataset.rel === rel);
  });
}

async function loadAtomArtifacts(id) {
  const box = document.getElementById('d-artifacts');
  if (!box) return;
  box.innerHTML = '<p class="res-empty">正在扫描工作目录…</p>';
  try {
    const r = await fetch('/api/atoms/' + encodeURIComponent(id) + '/artifacts');
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || '读取失败');
    const files = d.artifacts || [];
    if (!files.length) {
      box.innerHTML = '<p class="res-empty">还没有成果文件。Codex 在 Atom 目录里生成的文档、网页、压缩包等会自动出现在这里。</p>';
      return;
    }
    box.innerHTML = files.map(f => `<div class="res-row artifact-row" data-rel="${esc(f.path)}">
      <span class="res-icon">${esc(String(f.type || f.label || 'file').toUpperCase())}</span>
      <span class="res-main">
        <span class="res-name" title="${esc(f.path)}">${esc(f.name)}</span>
        <span class="res-sub">${esc(f.actor_label || '本地')} · ${esc(f.stage || '')} · ${esc(fmtDateTime(f.mtime) || '')}</span>
      </span>
      <span class="res-ops">
        ${isReadableArtifact(f) ? '<button class="btn ghost" data-op="read">阅读</button>' : ''}
        <button class="btn ghost" data-op="open">打开</button>
        <button class="btn ghost" data-op="reveal">定位</button>
      </span>
    </div>`).join('');
    if (readingRel) {
      box.querySelectorAll('.res-row').forEach(row => {
        row.classList.toggle('reading', row.dataset.rel === readingRel);
      });
    }
  } catch (err) {
    box.innerHTML = `<p class="res-empty">读取成果失败：${esc(err.message)}</p>`;
  }
}

async function openAtomArtifact(rel, op) {
  if (!current) return;
  if (op === 'read') { openInlineReader(rel); return; }
  const action = op === 'reveal' ? 'artifacts-reveal' : 'artifacts-open';
  const r = await fetch('/api/atoms/' + encodeURIComponent(current) + '/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: rel }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) toast('操作失败：' + (d.error || '未知错误'), 'error');
}

async function deleteCurrentAtom() {
  if (!current) return;
  const atom = STATE.atoms.find(a => a.id === current);
  const title = atom?.title || current;
  const ok = window.confirm(
    `确定删除 Atom ${current}「${title}」？\n\n` +
    '卡片、时间线和关联记录会被永久删除。\n' +
    '本地工作目录及其中由 Codex 生成的文件会保留。'
  );
  if (!ok) return;

  const btn = document.getElementById('d-delete');
  btn.disabled = true;
  btn.textContent = '删除中…';
  try {
    const r = await fetch('/api/atoms/' + encodeURIComponent(current), { method: 'DELETE' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || '删除失败');
    closeDrawer();
    await refresh();
  } catch (err) {
    window.alert(err.message || '删除失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '删除 Atom';
  }
}

function renderTimeline(items) {
  const tl = document.getElementById('d-tl');
  if (!items || !items.length) {
    tl.innerHTML = '<li><span class="node-brief">暂无事件</span></li>';
    return;
  }
  const VISIBLE = 5;
  const expanded = tl.dataset.expanded === '1';
  // 时间线以「最新事件」为第一视觉层级：无论折叠与否，都从新到旧排列。
  const ordered = [...items].sort((a, b) => {
    const ta = Date.parse(a.ts) || 0;
    const tb = Date.parse(b.ts) || 0;
    return tb - ta || Number(b.id || 0) - Number(a.id || 0);
  });
  const shown = expanded ? ordered : ordered.slice(0, VISIBLE);
  const hidden = ordered.length - shown.length;
  const row = it => `<li class="${esc(it.type)}">
      <span class="time">${fmtTime(it.ts)}</span>
      <span class="dot"></span>
      <span class="node">
        <span class="node-title">${esc(it.title)}${it.count > 1 ? `<span class="tag">${it.count}</span>` : ''}</span>
        ${it.brief ? `<span class="node-brief">${esc(it.brief)}</span>` : ''}
        ${it.files && it.files.length ? `<span class="node-files">${it.files.map(f => `<span class="file-chip" title="${esc(f)}">${esc(baseName(f))}</span>`).join('')}</span>` : ''}
        ${it.details && it.details.length ? `<span class="node-more" data-key="${it.id}">${it.details.length} 条过程细节</span>
          <span class="node-details" id="nd-${it.id}">${it.details.map(d => `<div class="d">${esc(String(d.message || d.type).slice(0, 400))}</div>`).join('')}</span>` : ''}
      </span>
    </li>`;
  let html = shown.map(row).join('');
  if (hidden > 0) {
    html += `<li class="more"><button class="btn ghost" id="tl-more">展开其余 ${hidden} 个事件</button></li>`;
  } else if (expanded) {
    html += `<li class="more"><button class="btn ghost" id="tl-less">收起</button></li>`;
  }
  tl.innerHTML = html;
  const more = document.getElementById('tl-more');
  if (more) more.addEventListener('click', () => { tl.dataset.expanded = '1'; renderTimeline(items); });
  const less = document.getElementById('tl-less');
  if (less) less.addEventListener('click', () => { tl.dataset.expanded = '0'; renderTimeline(items); });
}

function statusLabel(k) { const s = STATE.statuses.find(x => x.key === k); return s ? s.label : k; }

async function moveStatus() {
  if (!current) return;
  const id = current;
  const status = document.getElementById('d-status').value;
  const r = await fetch('/api/atoms/' + encodeURIComponent(id) + '/move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { toast('状态更新失败：' + (data.error || '未知错误'), 'error'); return; }
  await refresh();
  await openDetail(id, true);
}
document.getElementById('d-status').addEventListener('change', moveStatus);

document.getElementById('d-project').addEventListener('change', async e => {
  if (!current) return;
  const project_id = e.target.value;
  await fetch('/api/atoms/' + current + '/project', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id })
  });
  await refresh();
  openDetail(current, true);
});

async function runAtom() {
  if (!current) return;
  await fetch('/api/atoms/' + current + '/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
}

async function addLog() {
  const el = document.getElementById('d-log');
  const v = el.value.trim();
  if (!v || !current) return;
  const r = await fetch('/api/atoms/' + encodeURIComponent(current) + '/log', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: v })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { toast('记录失败：' + (data.error || '未知错误'), 'error'); return; }
  el.value = '';
  const id = current;
  await refresh();
  await openDetail(id, true);
}

async function saveTarget() {
  if (!current) return;
  const btn = document.getElementById('d-target-save');
  const target = document.getElementById('d-target').value.trim();
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const r = await fetch('/api/atoms/' + encodeURIComponent(current) + '/target', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || '保存失败');
    await refresh();
    await openDetail(current, true);
  } catch (err) {
    window.alert(err.message || '保存失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存目标';
  }
}

async function saveWordGoal() {
  if (!current) return;
  const btn = document.getElementById('d-word-goal-save');
  const raw = document.getElementById('d-word-goal').value;
  const word_goal = Math.max(0, Math.round(Number(raw) || 0));
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const r = await fetch('/api/atoms/' + encodeURIComponent(current) + '/word-goal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word_goal })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || '保存失败');
    await refresh();
    await loadWriting();
    render();
    await openDetail(current, true);
    toast(word_goal ? `目标字数已设为 ${word_goal} 字` : '已清空目标字数');
  } catch (err) {
    window.alert(err.message || '保存失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存字数目标';
  }
}

document.getElementById('d-tl').addEventListener('click', e => {
  const btn = e.target.closest('.node-more');
  if (!btn) return;
  const box = document.getElementById('nd-' + btn.dataset.key);
  if (!box) return;
  const label = btn.textContent;
  const open = box.classList.toggle('open');
  btn.textContent = open ? '收起过程细节' : label.replace('收起过程细节', '').trim() || '过程细节';
});

document.getElementById('d-run').addEventListener('click', runAtom);
document.getElementById('d-log-add').addEventListener('click', addLog);
document.getElementById('d-close-top').addEventListener('click', closeDrawer);
document.getElementById('d-target-save').addEventListener('click', saveTarget);
document.getElementById('d-target').addEventListener('keydown', e => { if (e.key === 'Enter') saveTarget(); });
document.getElementById('d-word-goal-save').addEventListener('click', saveWordGoal);
document.getElementById('d-word-goal').addEventListener('keydown', e => { if (e.key === 'Enter') saveWordGoal(); });
document.getElementById('d-delete').addEventListener('click', deleteCurrentAtom);
document.getElementById('d-open-folder').addEventListener('click', () => { if (current) openAtomFolder(current); });
document.getElementById('d-artifacts-refresh').addEventListener('click', () => { if (current) loadAtomArtifacts(current); });
document.getElementById('d-reader-clear').addEventListener('click', resetReader);
document.getElementById('d-artifacts').addEventListener('click', e => {
  const btn = e.target.closest('button[data-op]');
  const row = e.target.closest('[data-rel]');
  if (!btn || !row) return;
  openAtomArtifact(row.dataset.rel, btn.dataset.op);
});
document.getElementById('d-close').addEventListener('click', closeDrawer);
document.getElementById('d-log').addEventListener('keydown', e => { if (e.key === 'Enter') addLog(); });

document.getElementById('r-close').addEventListener('click', closeProjectResources);
document.getElementById('r-sync').addEventListener('click', syncProjectResources);
document.getElementById('r-export-manuscript').addEventListener('click', async () => {
  if (!resourceProjectId) return;
  const btn = document.getElementById('r-export-manuscript');
  const status = document.getElementById('r-status');
  btn.disabled = true;
  btn.textContent = '汇总中…';
  status.textContent = '正在把各章正文拼成全书稿…';
  try {
    const r = await fetch('/api/projects/' + resourceProjectId + '/manuscript/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || '导出失败');
    status.textContent = `已导出 ${d.chapters} 章 · ${fmtWords(d.total_words)} 字 → ${d.rel}`;
    toast('全书稿已导出：' + d.rel);
    await loadProjectResources();
  } catch (err) {
    status.textContent = '导出失败：' + err.message;
    toast('导出失败：' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '导出全书稿';
  }
});
document.getElementById('r-open-folder').addEventListener('click', async () => {
  if (!resourceProjectId) return;
  const r = await fetch('/api/projects/' + resourceProjectId + '/open', { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) toast('打开失败：' + (d.error || '未知错误'), 'error');
});
for (const boxId of ['r-local', 'r-getnote']) {
  document.getElementById(boxId).addEventListener('click', async e => {
    const btn = e.target.closest('button[data-op]');
    const row = e.target.closest('[data-rel]');
    if (!btn || !row) return;
    if (btn.dataset.op === 'read') {
      if (row.dataset.atom && row.dataset.atomPath) {
        const atomId = row.dataset.atom;
        const atomRel = row.dataset.atomPath;
        closeProjectResources();
        await openDetail(atomId);
        openInlineReader(atomRel);
      } else {
        openReader('project', resourceProjectId, row.dataset.rel);
      }
      return;
    }
    openProjectResourceFile(row.dataset.rel, btn.dataset.op);
  });
}

document.getElementById('scrim').addEventListener('click', () => {
  closeDrawer();
  closeProjectResources();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeSettings();
    closeDrawer();
    closeProjectResources();
    setProgressOpen(false);
  }
});

/* ---------- 快速新建（卡片右上角 +） ---------- */
function quickAdd(projectId, status, parentId) {
  openModal();
  if (projectId) document.getElementById('n-project').value = String(projectId);
  const s = document.getElementById('n-status');
  if (status && [...s.options].some(o => o.value === status)) s.value = status;
  const b = document.getElementById('n-body');
  if (!b.value && parentId) b.value = '关联原子：' + parentId;
  setTimeout(() => document.getElementById('n-title').focus(), 60);
}

/* ---------- 系统设置（整页） ---------- */
let TARGETS = [];

async function openSettings(tab = 'codex') {
  document.getElementById('settings-page').classList.add('open');
  document.getElementById('settings-page').setAttribute('aria-hidden', 'false');
  switchSettingsTab(tab);
  await Promise.all([loadConfigPanel(), loadStylePanel(), loadTransitionsPanel(), loadDataPanel()]);
  renderProjList();
}

function closeSettings() {
  document.getElementById('settings-page').classList.remove('open');
  document.getElementById('settings-page').setAttribute('aria-hidden', 'true');
}

function switchSettingsTab(tab) {
  document.querySelectorAll('#s-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  document.querySelectorAll('.s-panel').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  if (tab === 'projects') renderProjList();
  if (tab === 'data') loadDataPanel();
}

document.getElementById('cfg-open').addEventListener('click', () => openSettings('codex'));
document.getElementById('s-close').addEventListener('click', closeSettings);
document.getElementById('s-tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) switchSettingsTab(b.dataset.tab);
});

async function loadConfigPanel() {
  const r = await fetch('/api/config');
  const d = await r.json();
  const c = d.config;
  document.getElementById('c-bin').value = c.codex.bin || '';
  document.getElementById('c-model').value = c.codex.model || '';
  document.getElementById('c-sandbox').value = c.codex.sandbox || 'approve-for-me';
  document.getElementById('c-timeout').value = c.codex.timeoutSec || 900;
  document.getElementById('c-port').value = c.server.port || 7788;
}

async function loadStylePanel() {
  const r = await fetch('/api/style');
  STYLE = await r.json();
  const styleSel = document.getElementById('s-style');
  styleSel.innerHTML = (STYLE.styles || []).map(s => `<option value="${esc(s.slug)}">${esc(s.name || s.slug)}</option>`).join('');
  const themeSel = document.getElementById('s-theme');
  themeSel.innerHTML = (STYLE.themes || []).map(t => `<option value="${esc(t.slug)}">${esc(t.name || t.slug)}</option>`).join('');
  styleSel.value = STYLE.style || STYLE.defaultStyle || 'editorial';
  themeSel.value = STYLE.theme || STYLE.defaultTheme || 'white';
  renderStylePreview();
}

function renderStylePreview() {
  const sel = document.getElementById('s-style');
  const s = (STYLE.styles || []).find(x => x.slug === sel.value);
  document.getElementById('s-swatches').innerHTML =
    `<div class="s-preview">
       <span class="tag">AT</span>
       <span class="preview-title">原子事件</span>
       <button type="button" class="btn">按钮</button>
     </div>
     <p class="hint">${s ? esc(s.description || '') : ''}</p>`;
}

async function loadTransitionsPanel() {
  const [tr, tg] = await Promise.all([
    fetch('/api/transitions').then(r => r.json()),
    fetch('/api/targets').then(r => r.json()).catch(() => []),
  ]);
  TARGETS = Array.isArray(tg) ? tg : [];
  const skills = TARGETS.filter(t => t.type === 'skill');
  const box = document.getElementById('s-transitions');
  box.innerHTML = (tr.rules || []).map(r => `
    <article class="tr-row" data-from="${esc(r.from)}" data-to="${esc(r.to)}">
      <div class="tr-head">
        <span class="tr-flow">${esc(statusLabel(r.from))}<span class="arrow">→</span>${esc(statusLabel(r.to))}</span>
        <label class="switch"><input type="checkbox" data-f="enabled"${r.enabled ? ' checked' : ''}/> 启用</label>
        <label class="switch"><input type="checkbox" data-f="auto"${r.auto ? ' checked' : ''}/> 自动执行</label>
      </div>
      <div class="field">
        <input type="text" data-f="title" placeholder=" " value="${esc(r.title || '')}" />
        <label>规则名称</label>
      </div>
      <div class="field">
        <textarea data-f="prompt" rows="3" placeholder=" ">${esc(r.prompt || '')}</textarea>
        <label>追加给 Codex 的提示词</label>
      </div>
      <div class="field">
        <select data-f="skills" class="multi" multiple size="5">
          ${skills.map(s => `<option value="${esc(s.name)}"${(r.skills || []).includes(s.name) ? ' selected' : ''}>@${esc(s.name)} · ${esc(String(s.description || '').slice(0, 46))}</option>`).join('')}
        </select>
        <label>允许调用的 Skill（可多选）</label>
      </div>
    </article>`).join('') || '<p class="hint">暂无规则</p>';
}

async function saveTransitions() {
  const rules = [...document.querySelectorAll('#s-transitions .tr-row')].map(row => ({
    from: row.dataset.from,
    to: row.dataset.to,
    enabled: row.querySelector('[data-f="enabled"]').checked,
    auto: row.querySelector('[data-f="auto"]').checked,
    title: row.querySelector('[data-f="title"]').value.trim(),
    prompt: row.querySelector('[data-f="prompt"]').value,
    skills: [...row.querySelector('[data-f="skills"]').selectedOptions].map(o => o.value),
  }));
  await fetch('/api/transitions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
}

async function loadDataPanel() {
  const r = await fetch('/api/log?tail=1');
  const d = await r.json();
  const p = d.paths || {};
  document.getElementById('s-paths').innerHTML = [
    ['信息本体', p.ontologyMd],
    ['本体（机读）', p.ontologyJson],
    ['事件流', p.jsonl],
    ['可读日志', p.md],
    ['状态快照', p.state],
  ].map(([k, v]) => `<div class="data-path"><span>${esc(k)}</span><code>${esc(v || '')}</code></div>`).join('');
}

document.getElementById('s-style').addEventListener('change', () => {
  applyStyle(document.getElementById('s-style').value);
  renderStylePreview();
});
document.getElementById('s-theme').addEventListener('change', () => {
  applyTheme(document.getElementById('s-theme').value);
});
document.getElementById('s-style-save').addEventListener('click', async () => {
  const body = {
    style: document.getElementById('s-style').value,
    theme: document.getElementById('s-theme').value,
  };
  const r = await fetch('/api/style', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json();
  if (d.ok) {
    STYLE = { ...STYLE, ...d };
    alert('已保存为默认风格');
  }
});
document.getElementById('s-transitions-save').addEventListener('click', async () => {
  await saveTransitions();
  await loadTransitionsPanel();
  alert('拖动规则已保存');
});
document.getElementById('s-view-ontology').addEventListener('click', async () => {
  const out = document.getElementById('s-data-out');
  out.textContent = await fetch('/api/ontology').then(r => r.text());
});
document.getElementById('s-view-log').addEventListener('click', async () => {
  const out = document.getElementById('s-data-out');
  const d = await fetch('/api/log?tail=40').then(r => r.json());
  out.textContent = d.lines.map(line => {
    try { const e = JSON.parse(line); return `${fmtTime(e.ts)}  ${e.atom || '—'}  ${e.type}  ${e.message || ''}`; }
    catch { return line; }
  }).join('\n');
});
document.getElementById('s-sync').addEventListener('click', async () => {
  const out = document.getElementById('s-data-out');
  out.textContent = '正在同步…';
  const d = await fetch('/api/sync', { method: 'POST' }).then(r => r.json());
  out.textContent = d.ok ? `已同步 ${d.appended} 条新事件\n${d.paths.ontologyMd}\n${d.paths.md}` : '同步失败';
});

document.getElementById('p-add').addEventListener('click', async () => {
  const name = document.getElementById('p-name').value.trim();
  if (!name) return;
  await fetch('/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  document.getElementById('p-name').value = '';
  await refresh(); renderProjList();
});
document.getElementById('p-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('p-add').click(); });

document.getElementById('c-test').addEventListener('click', async () => {
  const out = document.getElementById('c-test-out');
  out.textContent = '正在测试…（会真的跑一次最小 codex exec）';
  const r = await fetch('/api/config/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deep: true })
  });
  const t = await r.json();
  const lines = [];
  lines.push('Codex   ' + (t.codex.version || '失败：' + t.codex.error));
  lines.push('路径    ' + t.codex.path + '  (' + t.codex.source + ')');
  if (t.probe) {
    lines.push('探针    ' + (t.probe.ok ? '通过 → ' + t.probe.reply : '失败：' + (t.probe.error || ('退出码 ' + t.probe.exitCode))));
    lines.push('用时    ' + (t.probe.durationMs / 1000).toFixed(1) + 's   会话 ' + (t.probe.threadId || '—'));
  }
  lines.push('得到大脑 ' + (t.getnote.ok ? '连通' : '失败：' + t.getnote.error));
  lines.push('');
  lines.push(t.ok ? '结论：全部通过' : '结论：存在问题');
  out.textContent = lines.join('\n');
});

document.getElementById('c-save').addEventListener('click', async () => {
  const patch = {
    codex: {
      bin: document.getElementById('c-bin').value.trim() || null,
      model: document.getElementById('c-model').value.trim() || null,
      sandbox: document.getElementById('c-sandbox').value,
      timeoutSec: Number(document.getElementById('c-timeout').value) || 900,
    },
    server: { port: Number(document.getElementById('c-port').value) || 7788 },
  };
  await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch })
  });
  document.getElementById('c-test-out').textContent = '已保存';
  await loadConfigPanel();
});

/* ---------- 新建 Atom ---------- */
function openModal() {
  const psel = document.getElementById('n-project');
  const cur = STATE.projects.find(p => filter === String(p.id));
  psel.innerHTML = STATE.projects.map(p =>
    `<option value="${p.id}"${cur && Number(cur.id) === Number(p.id) ? ' selected' : ''}>${esc(p.name)}</option>`
  ).join('');
  const ssel = document.getElementById('n-status');
  if (!ssel.options.length) {
    ssel.innerHTML = STATE.statuses.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
  }
  document.getElementById('new-form').reset();
  if (cur) psel.value = String(cur.id);
  ssel.value = 'todo';
  document.getElementById('modal').classList.add('open');
  document.getElementById('modal').setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('n-title').focus(), 60);
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.getElementById('modal').setAttribute('aria-hidden', 'true');
}

document.getElementById('n-cancel').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.getElementById('new-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    title: document.getElementById('n-title').value.trim(),
    body: document.getElementById('n-body').value,
    target: document.getElementById('n-target').value.trim(),
    word_goal: Math.max(0, Math.round(Number(document.getElementById('n-word-goal').value) || 0)),
    project_id: document.getElementById('n-project').value,
    priority: document.getElementById('n-priority').value,
    status: document.getElementById('n-status').value,
    mentions: document.getElementById('n-mentions').value.split(/[\s,，]+/).filter(Boolean),
  };
  if (!body.title) return;
  const r = await fetch('/api/atoms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const d = await r.json();
  if (d.ok) {
    closeModal();
    await refresh();
    openDetail(d.atom.id);
  }
});

async function refresh() {
  const r = await fetch('/api/state');
  STATE = await r.json();
  await loadWriting();
  render();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function baseName(p) {
  const s = String(p || '');
  return s.split(/[\\/]/).filter(Boolean).pop() || s;
}

boot();

