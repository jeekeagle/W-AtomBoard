export const STATUSES = [
  { key: 'idea',     label: '灵感',   color: '#8b8fa3' },
  { key: 'todo',     label: '待写',   color: '#4c8dff' },
  { key: 'in_progress', label: '写作中', color: '#f5a623' },
  { key: 'blocked',  label: '卡文',   color: '#e05252' },
  { key: 'in_review',label: '待审校', color: '#a06cff' },
  { key: 'done',     label: '定稿',   color: '#2fbf71' },
];

export const STATUS_KEYS = STATUSES.map(s => s.key);
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const TRANSITIONS = {
  idea:        ['todo'],
  todo:        ['in_progress', 'blocked', 'idea'],
  in_progress: ['blocked', 'in_review', 'done', 'todo'],
  blocked:     ['in_progress', 'todo'],
  in_review:   ['done', 'in_progress', 'blocked'],
  done:        ['in_progress', 'todo'],
};

export function isStatus(s) { return STATUS_KEYS.includes(s); }
export function isPriority(p) { return PRIORITIES.includes(p); }

export function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

export function allowedTransitions(from) {
  return TRANSITIONS[from] || [];
}

export function labelOf(key) {
  return STATUSES.find(s => s.key === key)?.label || key;
}

export function statusColor(key) {
  return STATUSES.find(s => s.key === key)?.color || '#8b8fa3';
}

/** 进度百分比与状态的推荐对应（当没有 runner 事件可依据时） */
export function progressForStatus(status) {
  switch (status) {
    case 'idea': return 0;
    case 'todo': return 0;
    case 'in_progress': return 50;
    case 'blocked': return 50;
    case 'in_review': return 85;
    case 'done': return 100;
    default: return 0;
  }
}

/* ============================================================
   事件分级 —— 时间线以「事件」为中心，而不是以日志流水为中心
   milestone ：值得占一行的时间线节点（进度信息）
   detail    : 过程细节（命令、思考、回合），默认收进所属里程碑里
   ============================================================ */
export const EVENT_LEVEL = {
  created: 'milestone',
  status: 'milestone',
  plan: 'milestone',
  output: 'milestone',
  file: 'milestone',
  error: 'milestone',
  input: 'milestone',
  manual: 'milestone',
  link: 'milestone',
  getnote: 'milestone',
  note: 'milestone',
  run_start: 'milestone',
  run_end: 'milestone',
  project: 'milestone',
  command: 'detail',
  thinking: 'detail',
  tool: 'detail',
  turn: 'detail',
  usage: 'detail',
  thread: 'detail',
};

export function eventLevel(type) {
  return EVENT_LEVEL[type] || 'detail';
}

/** 里程碑的一句话标题（以事件为主语，而不是日志） */
export function eventTitle(e) {
  const t = e.type;
  switch (t) {
    case 'created': return '创建了这个写作任务';
    case 'status': return '写作阶段变更';
    case 'plan': return '写作准备';
    case 'output': return '写作结论';
    case 'file': return '稿件产出';
    case 'error': return '写作中断';
    case 'input': return '用户输入';
    case 'manual': return e.data?.title || '手动记录';
    case 'link': return '建立关联';
    case 'getnote': return '同步到得到大脑';
    case 'note': return '人工记录';
    case 'run_start': return '开始写作';
    case 'run_end': return '写作结束';
    case 'project': return '项目变更';
    default: return e.type;
  }
}
