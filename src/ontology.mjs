/**
 * W-AtomBoard 信息本体 —— 所有 Agent 读取这份文件即可理解整个系统。
 * 它是「模型」：实体、关系、状态机、写作度量、接口、约定。
 * 生成物：ontology/watomboard.json（机读）、ontology/WATOMBOARD.md（人读）
 */
import { fmtDateTime } from './time.mjs';

export const ONTOLOGY = {
  name: 'W-AtomBoard',
  version: '0.3',
  tagline: '写作原子看板 —— 一个 Atom 是一个选题或一章，指派给 @codex / @skill / @agent 写，稿件落盘，字数回流，并与得到大脑笔记互通。',
  purpose: [
    '把一本书拆成可独立动笔、可被指派、可被审校的选题与章节（Atom）',
    '执行体（Codex / 技能 / 自定义 Agent）的每一次写作、产出、报错都留痕并回写看板',
    '以「字数」为核心度量：目标字数写在 Atom 上，已写字数从真实稿件文件统计，不另建字数表',
    '看板状态与得到大脑（GetNote）笔记双向互通：笔记可作为上下文注入，结论可回存为笔记',
  ],

  storage: {
    engine: 'SQLite（Node 24 内置 node:sqlite，零第三方依赖）',
    file: 'data/watomboard.db',
    mode: 'WAL',
    tables: ['projects', 'atoms', 'events', 'links', 'runs'],
  },

  entities: [
    {
      name: 'Project',
      meaning: '一本书 / 一个专栏，一个看板分组，同时也是本地的一个文件夹。',
      key: 'projects.id',
      fields: [
        { key: 'key', type: 'string', note: '命令行可引用的短标识，ASCII，小写连字符' },
        { key: 'name', type: 'string', note: '书名 / 专栏名，可用中文' },
        { key: 'description', type: 'string', note: '一句话说明这本书写什么' },
        { key: 'status', type: 'enum', values: ['active', 'archived'] },
        { key: 'folder', type: 'string?', note: '项目目录；默认 <根>/workspaces/<key>' },
      ],
      relations: [
        '一个 Project 拥有多个 Atom',
        '一个 Project 对应一个本地文件夹，文件夹下每个 Atom 是一个子文件夹',
        '一个 Project 对应一个得到大脑知识库：WATOM-<项目名>',
      ],
    },
    {
      name: 'Atom',
      meaning: '选题或章节 —— 看板的最小写作单元。',
      key: 'atoms.id',
      idFormat: 'AT-<序号，全局递增>',
      fields: [
        { key: 'project_id', type: 'int → projects.id', note: '所属项目，可随时改归属' },
        { key: 'title', type: 'string', note: '选题 / 章节名' },
        { key: 'body', type: 'string', note: '写作要求、素材线索、读者设定；@ 提及写在这里也会被解析' },
        { key: 'target', type: 'string', note: '交付目标，例如「形成一篇 3000 字的读者指南」' },
        { key: 'word_goal', type: 'int', note: '目标字数；0 表示未设' },
        { key: 'status', type: 'enum', note: '见 stateMachine' },
        { key: 'priority', type: 'enum', values: ['low', 'normal', 'high', 'urgent'] },
        { key: 'mentions', type: 'json[]', note: '[{type,name,raw}]，决定谁来写' },
        { key: 'progress', type: 'int 0-100', note: '由执行体事件流与状态推导' },
        { key: 'thread_id', type: 'string?', note: '执行产生的 codex 会话 id，便于追溯' },
        { key: 'workspace', type: 'string?', note: '执行体的工作目录' },
        { key: 'folder', type: 'string?', note: 'Atom 的本地目录；正文写 draft.md，素材放 素材/' },
      ],
      relations: ['属于一个 Project', '拥有多条 Event', '可以关联多条 Link', '目录里的正文文件即它的字数来源'],
    },
    {
      name: 'Event',
      meaning: '写作时间线条目 —— 以事件为中心，而不是以日志流水为中心。',
      key: 'events.id',
      fields: [
        { key: 'atom_id', type: 'string → atoms.id' },
        { key: 'ts', type: 'ISO8601' },
        { key: 'type', type: 'string', values: ['created', 'status', 'note', 'output', 'thinking', 'command', 'file', 'plan', 'tool', 'error', 'link', 'getnote', 'thread', 'turn', 'usage', 'run_start', 'run_end', 'manual'] },
        { key: 'actor', type: 'string', values: ['user', 'board', 'codex', 'system', 'ui'] },
        { key: 'message', type: 'string' },
        { key: 'data', type: 'json' },
      ],
      relations: ['只追加，永不修改 —— 这是所有 Agent 的共享事实来源'],
    },
    {
      name: 'Link',
      meaning: 'Atom 与外部对象的关联。',
      key: 'links.id',
      fields: [
        { key: 'kind', type: 'enum', values: ['getnote', 'url'] },
        { key: 'target', type: 'string', note: '得到大脑笔记 id 或 URL' },
        { key: 'title', type: 'string' },
      ],
      relations: ['getnote 类型的 target 即得到大脑 note_id'],
    },
    {
      name: 'Mention',
      meaning: '执行体的指派标记，写在标题或描述里。',
      fields: [
        { key: 'type', type: 'enum', values: ['codex', 'skill', 'agent'] },
        { key: 'name', type: 'string' },
        { key: 'raw', type: 'string', note: '原文，如 @skill:baoyu-diagram' },
      ],
      rules: [
        '@codex —— 默认执行体',
        '@skill:<名字> —— 定位 ~/.codex/skills、~/.agents/skills、项目 skills/ 下的 SKILL.md，注入为 $<名字> 触发',
        '@agent:<名字> —— 定义在 agents.json（项目根或 ~/.watomboard/agents.json）',
        '裸 @名字 —— 先找技能，再找 Agent',
      ],
    },
  ],

  stateMachine: {
    statuses: ['idea', 'todo', 'in_progress', 'blocked', 'in_review', 'done'],
    statusLabels: {
      idea: '灵感', todo: '待写', in_progress: '写作中',
      blocked: '卡文', in_review: '待审校', done: '定稿',
    },
    transitions: {
      idea: ['todo'],
      todo: ['in_progress', 'blocked', 'idea'],
      in_progress: ['blocked', 'in_review', 'done', 'todo'],
      blocked: ['in_progress', 'todo'],
      in_review: ['done', 'in_progress', 'blocked'],
      done: ['in_progress', 'todo'],
    },
    rules: [
      '执行体只能把 Atom 推进到 in_review（待审校）；done（定稿）必须由人确认',
      '自动推进：todo → in_progress → in_review；失败则落到 blocked（卡文）',
      '拖动到某状态会触发该转换的「准备流程」：追加一段提示词给 Codex，可选注入技能',
    ],
  },

  writing: {
    metric: '字数 —— 中文按字计，英文/数字按词计；剔除代码块、链接地址与 HTML 标签',
    source: 'Atom 目录里的真实 .md / .markdown / .txt 文件；不另建字数表',
    excludedDirs: ['素材', '资料', '参考', 'notes', 'materials', 'references'],
    conventions: [
      '正文写进 Atom 目录的 draft.md（可另建章节文件，同属正文）',
      '素材、访谈、参考放 素材/ 目录，不计入字数',
      '项目目录下 manuscript/ 存放拼好的全书稿',
      '项目级成果（封面、目录、样章）不属于任何 Atom，但属于项目',
    ],
    manuscript: {
      build: '按 Atom 的 seq 顺序，把各 Atom 的正文拼成一份 Markdown 书稿',
      export: 'watomboard project export <key> [--status in_review,done] → <项目目录>/manuscript/全书稿-YYYY-MM-DD.md',
      timezone: 'Asia/Shanghai',
    },
  },

  execution: {
    command: 'codex exec --json --skip-git-repo-check --approve-for-me [--sandbox <mode>] [-C <dir>] <prompt>',
    eventStream: 'JSONL：thread.started / turn.started / item.completed / turn.completed',
    progress: '由 item.completed 中的 todo_list、command_execution、agent_message 等事件推进；最终由状态决定',
    safeguards: [
      { name: '递归保护', detail: '子进程带 ATOMBOARD_DEPTH 计数；执行体内部再调 watomboard atom run 会被拒绝' },
      { name: '执行边界', detail: 'prompt 内明确禁止执行 watomboard 命令、禁止改动看板数据库与配置' },
      { name: '沙箱', detail: '默认 --approve-for-me（可写 + 自动审批）；--sandbox read-only 可收紧' },
      { name: '验收权', detail: '定稿（done）由人确认，执行体不得自行标记定稿' },
    ],
  },

  design: {
    styleSystem: '双层 token：风格层(data-style) 管形状/动效/强调色，主题层(data-theme) 管底色/面色/墨色',
    defaultStyle: 'editorial',
    defaultTheme: 'white',
    styles: [
      { slug: 'editorial', name: '编辑杂志风', reference: 'styles/editorial.md', traits: ['纯单色', '衬线标题', '发丝线分隔', '无阴影无圆角', 'hover 斜体', '下划线动画'] },
    ],
    themes: [
      { slug: 'white', name: '白色' },
      { slug: 'cream', name: '暖米' },
      { slug: 'ink', name: '墨色' },
    ],
    rules: [
      '卡片左缘必须与页面标题左缘对齐（同一 shell 内边距）',
      '「+」新建入口放在 灵感 / 待写 / 写作中 三列的列头右上角',
      '可交互元素必须有 hover / active / focus-visible 三态',
      '时间线以事件为中心：milestone 占一行，过程细节收进所属里程碑',
    ],
  },

  codex: {
    default: 'codex-cli 0.163.0（npm 安装的正式版）',
    alternatives: [
      { name: 'desktop', desc: '桌面版内置 codex.exe（0.163.0-alpha.11），命令别名 codex-desktop' },
      { name: 'app-server', desc: '~/.codex/packages/app-server-daemon 内的 0.163.0' },
    ],
    resolution: '显式配置 data/config.json 的 codex.bin > 桌面版内置 > PATH',
    commands: { codex: '默认正式版', 'codex-desktop': '桌面版内置 alpha' },
  },

  integrations: {
    getnote: {
      cli: 'getnote（@getnote/cli，本机已登录）',
      kb: '每个项目一个知识库，命名 WATOM-<项目名>；项目里的 Atom 启动的 Codex 都可以读它',
      read: 'watomboard note search "<关键词>" [--limit N] [--kb ID] —— 语义检索',
      write: 'watomboard atom push <AT-id> —— 把写作要求 + 最终稿件存成一篇笔记',
      link: 'watomboard atom link <AT-id> --note <note_id>',
      inject: 'watomboard atom run <AT-id> --note-query "<关键词>" —— 检索到的笔记片段注入 prompt 的「相关笔记」段',
    },
  },

  interfaces: {
    cli: {
      entry: 'node bin/watomboard.mjs <命令>',
      global: 'watomboard（等价命令，装在 ~/.local/bin）',
      commands: {
        'project add/list': '项目管理（一本书）',
        'project export <key>': '导出全书稿',
        'atom new/list/show': '建选题、看列表、看详情与时间线',
        'atom words <id> [n]': '查看字数 / 设置目标字数',
        'atom stats <项目>': '项目写作统计',
        'atom move <id> <status>': '改状态并留痕',
        'atom log <id> <消息>': '记一条写作进展',
        'atom run <id> [--background] [--workspace 目录] [--note-query 关键词] [--dry-run]': '动笔；dry-run 只打印将要发出的 prompt',
        'atom link <id> --note <id>': '关联得到大脑笔记',
        'atom push <id>': '把稿件推送到得到大脑',
        'atom delete <id>': '删除',
        targets: '列出所有可用的 @ 执行目标',
        board: '终端文本看板',
        'serve [--port 7789]': '本地看板 Web UI（SSE 实时推送）',
        'note search/show/save': '直接操作得到大脑',
        'ontology [--print]': '读取/重新生成信息本体',
        'log [--tail N]': '读取全局 Log',
        state: '打印当前看板状态快照',
        'style [--theme white|cream|ink]': '风格与主题',
        doctor: '自检',
      },
    },
    http: {
      base: 'http://127.0.0.1:7789',
      endpoints: {
        'GET /api/state': '看板全量状态',
        'GET /api/style': '风格与主题注册表',
        'GET /api/targets': '可用 @ 执行目标',
        'GET /api/stream': 'SSE 实时状态推送',
        'GET /api/writing': '全部项目的字数汇总',
        'GET /api/projects/:id/writing': '单项目字数统计',
        'GET /api/projects/:id/manuscript?statuses=a,b': '拼好的全书稿',
        'POST /api/projects/:id/manuscript/export': '导出全书稿到项目目录',
        'GET /api/atoms/:id': '单个选题 + 事件 + 关联 + 字数',
        'GET /api/atoms/:id/writing': '单个选题的字数与正文文件',
        'POST /api/atoms/:id/word-goal': '设目标字数 {word_goal}',
        'POST /api/atoms': '新建选题 {title, body, target, project_id, priority, status, mentions[], word_goal}',
        'POST /api/atoms/:id/target': '改交付目标 {target}',
        'POST /api/atoms/:id/project': '改所属项目 {project_id}',
        'POST /api/atoms/:id/move': '改状态 {status}',
        'POST /api/atoms/:id/log': '记日志 {message}',
        'POST /api/atoms/:id/run': '就地执行',
        'POST /api/projects': '新建项目 {name, description}',
      },
    },
    files: {
      'ontology/watomboard.json': '信息本体（机读）',
      'ontology/WATOMBOARD.md': '信息本体（人读）',
      'logs/events.jsonl': '全局事件流，追加写入，永不改写',
      'logs/LOG.md': '全局 Log 的可读渲染',
      'logs/STATE.md': '当前状态快照',
      'agents.json': '自定义 Agent 定义',
      'skills/w-atomboard/SKILL.md': '给 Codex 的技能包（已装到 ~/.codex/skills/）',
      'workspaces/<项目>/<Atom>/draft.md': 'Atom 的正文',
      'workspaces/<项目>/<Atom>/素材/': 'Atom 的素材，不计字数',
      'workspaces/<项目>/manuscript/': '全书稿',
    },
  },

  conventions: [
    '所有写操作都必须留痕：任何状态变化、稿件产出、关联都要产生一条 Event',
    'Agent 读取看板的标准入口：先读 ontology/WATOMBOARD.md，再读 logs/STATE.md，需要历史就读 logs/LOG.md',
    '不要手改 data/watomboard.db；所有变更走 CLI 或 HTTP 接口',
    '执行体不得自行把 Atom 标记为定稿（done）',
    '正文只写 Atom 目录下的 .md/.markdown/.txt；素材放 素材/，避免被计入字数',
    '时间线以事件为中心：新增一个里程碑事件，并带上产出文件路径',
  ],
};

export function ontologyJSON() {
  return JSON.stringify(ONTOLOGY, null, 2);
}

export function ontologyMarkdown() {
  const o = ONTOLOGY;
  const L = [];
  L.push(`# ${o.name} 信息本体`);
  L.push('');
  L.push(`> ${o.tagline}`);
  L.push('');
  L.push(`版本 ${o.version} · 生成于 ${fmtDateTime(new Date())}（北京时间）`);
  L.push('');
  L.push('这份文件是 W-AtomBoard 的**本体**：它定义了这套系统里有什么、怎么流转、怎么被调用。');
  L.push('任何 Agent —— 人、Codex、技能、自定义 Agent —— 都应该先读它，再动手。');
  L.push('');
  L.push('## 目的');
  L.push('');
  o.purpose.forEach(p => L.push(`- ${p}`));
  L.push('');
  L.push('## 存储');
  L.push('');
  L.push(`- 引擎：${o.storage.engine}`);
  L.push(`- 文件：\`${o.storage.file}\`（${o.storage.mode}）`);
  L.push(`- 表：${o.storage.tables.map(t => `\`${t}\``).join('、')}`);
  L.push('');
  L.push('## 实体');
  L.push('');
  for (const e of o.entities) {
    L.push(`### ${e.name}`);
    L.push('');
    L.push(`${e.meaning}`);
    L.push('');
    if (e.idFormat) L.push(`- id 格式：${e.idFormat}`);
    L.push('- 字段：');
    for (const f of e.fields) {
      const extra = f.values ? ` \`${f.values.join(' | ')}\`` : (f.note ? ` —— ${f.note}` : '');
      L.push(`  - \`${f.key}\` : ${f.type}${extra}`);
    }
    if (e.relations) { L.push('- 关系：'); e.relations.forEach(r => L.push(`  - ${r}`)); }
    if (e.rules) { L.push('- 规则：'); e.rules.forEach(r => L.push(`  - ${r}`)); }
    L.push('');
  }
  L.push('## 状态机');
  L.push('');
  L.push('| 状态 | key |');
  L.push('| --- | --- |');
  for (const [k, label] of Object.entries(o.stateMachine.statusLabels)) L.push(`| ${label} | \`${k}\` |`);
  L.push('');
  L.push('| 从 | 可到 |');
  L.push('| --- | --- |');
  for (const [from, tos] of Object.entries(o.stateMachine.transitions)) {
    L.push(`| ${from} | ${tos.map(t => `\`${t}\``).join(', ')} |`);
  }
  L.push('');
  o.stateMachine.rules.forEach(r => L.push(`- ${r}`));
  L.push('');
  L.push('## 写作度量');
  L.push('');
  L.push(`- 度量：${o.writing.metric}`);
  L.push(`- 事实来源：${o.writing.source}`);
  L.push(`- 不计入字数的目录：${o.writing.excludedDirs.map(d => `\`${d}/\``).join('、')}`);
  L.push('- 约定：');
  o.writing.conventions.forEach(c => L.push(`  - ${c}`));
  L.push('- 书稿：');
  L.push(`  - 拼接：${o.writing.manuscript.build}`);
  L.push(`  - 导出：${o.writing.manuscript.export}`);
  L.push(`  - 时区：${o.writing.manuscript.timezone}`);
  L.push('');
  L.push('## 执行');
  L.push('');
  L.push(`- 命令：\`${o.execution.command}\``);
  L.push(`- 事件流：${o.execution.eventStream}`);
  L.push(`- 进度：${o.execution.progress}`);
  L.push('- 安全阀：');
  o.execution.safeguards.forEach(s => L.push(`  - **${s.name}** —— ${s.detail}`));
  L.push('');
  L.push('## 设计系统');
  L.push('');
  L.push(`- 结构：${o.design.styleSystem}`);
  L.push(`- 默认风格：\`${o.design.defaultStyle}\`，默认主题：\`${o.design.defaultTheme}\``);
  L.push('');
  L.push('| 风格 | 名称 | 规范文件 | 特征 |');
  L.push('| --- | --- | --- | --- |');
  for (const s of o.design.styles) {
    L.push(`| \`${s.slug}\` | ${s.name} | \`${s.reference}\` | ${s.traits.join('、')} |`);
  }
  L.push('');
  L.push(`主题：${o.design.themes.map(t => '`' + t.slug + '`').join(' / ')}`);
  L.push('');
  o.design.rules.forEach(r => L.push(`- ${r}`));
  L.push('');
  L.push('## Codex');
  L.push('');
  L.push(`- 默认：${o.codex.default}`);
  L.push(`- 解析顺序：${o.codex.resolution}`);
  L.push('- 其他可用：');
  o.codex.alternatives.forEach(a => L.push(`  - ${a.name} —— ${a.desc}`));
  L.push(`- 命令：${Object.entries(o.codex.commands).map(([k, v]) => '`' + k + '` → ' + v).join('，')}`);
  L.push('');
  L.push('## 集成：得到大脑');
  L.push('');
  L.push(`- 客户端：${o.integrations.getnote.cli}`);
  L.push(`- 知识库：${o.integrations.getnote.kb}`);
  L.push(`- 读：${o.integrations.getnote.read}`);
  L.push(`- 写：${o.integrations.getnote.write}`);
  L.push(`- 关联：${o.integrations.getnote.link}`);
  L.push(`- 注入上下文：${o.integrations.getnote.inject}`);
  L.push('');
  L.push('## 接口');
  L.push('');
  L.push('### CLI');
  L.push('');
  L.push(`入口：\`${o.interfaces.cli.entry}\`（全局命令 \`${o.interfaces.cli.global}\`）`);
  L.push('');
  L.push('| 命令 | 作用 |');
  L.push('| --- | --- |');
  for (const [c, d] of Object.entries(o.interfaces.cli.commands)) L.push(`| \`${c}\` | ${d} |`);
  L.push('');
  L.push('### HTTP');
  L.push('');
  L.push(`基址：\`${o.interfaces.http.base}\``);
  L.push('');
  for (const [ep, d] of Object.entries(o.interfaces.http.endpoints)) L.push(`- \`${ep}\` —— ${d}`);
  L.push('');
  L.push('### 磁盘契约');
  L.push('');
  for (const [f, d] of Object.entries(o.interfaces.files)) L.push(`- \`${f}\` —— ${d}`);
  L.push('');
  L.push('## 约定');
  L.push('');
  o.conventions.forEach(c => L.push(`- ${c}`));
  L.push('');
  return L.join('\n');
}
