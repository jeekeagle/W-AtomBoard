import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addEvent, updateAtom, getAtom, getProject, upsertRun } from './store.mjs';
import { atomFolder, projectFolder, ensureDir } from './workspaces.mjs';
import { findSkill } from './mentions.mjs';
import { resolveMention } from './mentions.mjs';
import { readConfig } from './config.mjs';

const HOME = os.homedir();

/**
 * 定位 codex 可执行文件。优先级：
 *   环境变量覆盖 > 系统设置里配置的 codex.bin > 桌面版内置 > PATH
 * 配置来源为 data/config.json 与 ~/.watomboard/config.json。
 */
export function resolveCodexBin(options = {}) {
  // 显式覆盖：测试或特殊场景下指定可执行文件
  // ATOMBOARD_CODEX_BIN = 可执行文件路径；ATOMBOARD_CODEX_ARGS = JSON 数组形式的额外参数
  const override = process.env.ATOMBOARD_CODEX_BIN;
  if (override) {
    let extra = [];
    try {
      const raw = process.env.ATOMBOARD_CODEX_ARGS;
      if (raw) extra = JSON.parse(raw);
      if (!Array.isArray(extra)) extra = [];
    } catch { extra = []; }
    return { cmd: override, args: extra, shell: false };
  }
  const configured = options.bin
    || process.env.ATOMBOARD_CODEX_PATH
    || readConfiguredBin(options.root);
  if (configured && existsSync(configured)) {
    return { cmd: configured, args: [], shell: false };
  }
  const base = path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  if (existsSync(base)) {
    const dirs = readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(base, d.name))
      .filter(d => existsSync(path.join(d, 'codex.exe')));
    if (dirs.length) return { cmd: path.join(dirs[0], 'codex.exe'), args: [], shell: false };
  }
  return { cmd: 'codex', args: [], shell: process.platform === 'win32' };
}

/** 从系统设置读取用户指定的 codex 可执行文件（不抛错，读不到就当作没配） */
function readConfiguredBin(root) {
  const candidates = [];
  if (root) candidates.push(path.join(root, 'data', 'config.json'));
  candidates.push(path.join(HOME, '.watomboard', 'config.json'));
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const cfg = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const bin = cfg?.codex?.bin;
      if (bin && typeof bin === 'string') return bin;
    } catch { /* 配置损坏时回落到默认定位 */ }
  }
  return null;
}

/**
 * 构造发给执行体的 prompt。
 * mention 中的 skill 用 $skill-name 触发（Codex 的技能调用语法）。
 */
export function buildPrompt(atom, resolved, context = {}) {
  const lines = [];
  lines.push(`你正在为 W-AtomBoard 写作原子 ${atom.id} 写作：${atom.title}`);
  lines.push('');
  if (atom.body) {
    lines.push('## 写作要求');
    lines.push(atom.body);
    lines.push('');
  }
  if (atom.target) {
    lines.push('## 交付目标');
    lines.push(atom.target);
    lines.push('');
  }
  if (Number(atom.word_goal) > 0) {
    lines.push('## 目标字数');
    lines.push(`约 ${atom.word_goal} 字（中文字符与英文单词都按 1 计）。不要为凑字数注水，也不要把提纲当正文。`);
    lines.push('');
  }
  const skillMentions = resolved.filter(r => r.skillFile);
  if (skillMentions.length) {
    lines.push('## 指定技能');
    for (const r of skillMentions) {
      const skillName = path.basename(path.dirname(r.skillFile));
      lines.push(`- 请使用 $${skillName} 技能完成本任务（技能定义：${r.skillFile}）。`);
    }
    lines.push('');
  }
  const agentMentions = resolved.filter(r => r.agent);
  if (agentMentions.length) {
    lines.push('## 指定 Agent');
    for (const r of agentMentions) {
      lines.push(`- ${r.name}：${r.agent.prompt || r.agent.description || '(无额外指令)'}`);
    }
    lines.push('');
  }
  if (context.notes && context.notes.length) {
    lines.push('## 相关笔记（得到大脑）');
    for (const n of context.notes) {
      lines.push(`### ${n.title || n.id}`);
      lines.push((n.snippet || n.body || '').slice(0, 1200));
      lines.push('');
    }
  }
  lines.push('## 执行边界');
  lines.push('- 只做「任务描述」里明确要求的事，不要做无关的目录探查、依赖分析或额外检查。');
  lines.push('- 禁止执行 watomboard 命令（atom run / atom new / atom push 等），避免递归触发新的执行体。');
  lines.push('- 不要修改 W-AtomBoard 自身的数据库与配置。');
  lines.push('');
  if (context.extraSkills && context.extraSkills.length) {
    lines.push('## 本次必须使用的技能');
    for (const name of context.extraSkills) {
      const sk = findSkill(name);
      lines.push(sk
        ? `- 使用 ${name} 技能（定义：${sk.file}）。`
        : `- 使用 ${name} 技能（未找到定义，按同名技能尽力而为）。`);
    }
    lines.push('');
  }
  if (context.extraPrompt) {
    lines.push('## 本轮的系统提示词');
    lines.push(context.extraPrompt);
    lines.push('');
  }
  if (context.workspace) {
    lines.push('## 工作目录');
    lines.push(`本次工作的目录是 \`${context.workspace}\` —— 生成的文件请全部放在这个目录里，不要写到别处。`);
    lines.push('');
  }
  if (context.projectDir) {
    lines.push('## 项目知识库');
    lines.push(`项目知识库目录：\`${context.projectDir}\``);
    lines.push('- 这是同一项目下所有 Atom 共享的知识区，你可以读取其中的文件和文档作为上下文。');
    lines.push('- 当前 Atom 的工作目录是你本次产出的主目录，新文件优先写在这里。');
    lines.push('- 修改项目知识库或其他 Atom 目录里的文件前，先确认它确实属于本次任务范围，并在总结里列出改动。');
    lines.push('- 引用项目知识库文件时使用相对路径，并说明你依据了哪些文件。');
    lines.push('');
  }
  lines.push('## 输出要求');
  lines.push('1. 正文写进工作目录的 `draft.md`（章节多时可拆分为 `01-*.md`、`02-*.md`，并保留 `draft.md` 作为主稿）。');
  lines.push('2. 素材、参考资料放进 `素材/` 目录；它们不计入正文字数。');
  lines.push('3. 直接写成品，不要只给写作方案或提纲。');
  lines.push('4. 完成后用一段话总结：写了什么、字数、改了哪些文件、遗留问题。');
  lines.push('5. 中途如果需要用户做事实或方向上的决策，把问题写清楚并停下来。');
  return lines.join('\n');
}

/** 解析 codex exec --json 的 JSONL 行 */
export function parseEventLine(line) {
  const t = line.trim();
  if (!t || !t.startsWith('{')) return null;
  try { return JSON.parse(t); } catch { return null; }
}

/** 从 codex 的 item 事件里抽取可读进度 */
export function summarizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const t = item.type;
  switch (t) {
    case 'agent_message':      return { kind: 'message', text: item.text || '' };
    case 'agent_reasoning':
    case 'reasoning':          return { kind: 'reasoning', text: item.text || item.summary || '' };
    case 'command_execution':  return { kind: 'command', text: item.command || item.text || '', exit: item.exit_code };
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const paths = changes
        .map(c => (typeof c === 'string' ? c : c?.path || c?.file || c?.name))
        .filter(Boolean);
      const direct = item.path || item.file;
      if (direct && !paths.includes(direct)) paths.unshift(direct);
      return { kind: 'file', text: paths.join('\n'), paths, changes: item.changes };
    }
    case 'todo_list':          return { kind: 'todo', todos: item.todos || [] };
    case 'error':              return { kind: 'error', text: item.message || item.text || '' };
    case 'mcp_tool_call':
    case 'web_search':         return { kind: 'tool', text: item.tool || item.query || item.name || t };
    default:                   return null;
  }
}

export function progressFromTodos(todos) {
  if (!Array.isArray(todos) || !todos.length) return null;
  const done = todos.filter(x => x.status === 'completed').length;
  return Math.round((done / todos.length) * 90);
}

/**
 * 决定用什么命令执行：
 *  - 有自定义 agent 且 cmd 不是 codex → 直接跑那个 CLI，prompt 走 stdin
 *  - 否则 → codex exec --json
 */
export function buildCommand(resolved, prompt, options = {}) {
  const workspace = options.workspace || null;
  const addDirs = (options.addDirs || []).filter(d => d && d !== workspace);
  const agent = resolved.find(r => r.agent);
  if (agent) {
    const def = agent.agent;
    const cmd = String(def.cmd || 'codex');
    if (!/^codex(\.exe)?$/i.test(cmd)) {
      return {
        cmd, args: def.args || [], shell: true, stdin: prompt, jsonl: false,
        label: `${cmd} (${agent.name})`,
      };
    }
    const codex = resolveCodexBin({ root: options.root });
    const base = ['exec', '--json', '--skip-git-repo-check'];
    const args = [...codex.args, ...(def.args && def.args.length ? def.args : base)];
    if (options.sandbox) args.push('--sandbox', options.sandbox);
    else if (options.approve !== false) args.push('--approve-for-me');
    if (workspace) args.push('-C', workspace);
    for (const dir of addDirs) args.push('--add-dir', dir);
    args.push(prompt);
    return { cmd: codex.cmd, args, shell: codex.shell, stdin: null, jsonl: true, label: `codex (${agent.name})` };
  }
  const codex = resolveCodexBin({ root: options.root });
  const args = [
    ...codex.args,
    'exec', '--json', '--skip-git-repo-check',
    ...(options.sandbox ? ['--sandbox', options.sandbox] : ['--approve-for-me']),
    ...(workspace ? ['-C', workspace] : []),
    ...addDirs.flatMap(d => ['--add-dir', d]),
    prompt,
  ];
  return { cmd: codex.cmd, args, shell: codex.shell, stdin: null, jsonl: true, label: 'codex' };
}

/** 执行一个 atom。逐条把事件写回 DB（服务端靠轮询 DB 把进度推给 UI）。 */
export async function runAtom(db, atomId, options = {}) {
  const atom = getAtom(db, atomId);
  if (!atom) throw new Error(`Atom 不存在: ${atomId}`);
  // 准备流程（拖动触发）允许在「进行中」列的原子上再跑一次：它做的是规划/体检，
  // 不是重复执行同一件事。普通手动执行仍然拒绝重复跑。
  const isPrepare = !!options.prepare;
  if (atom.status === 'in_progress' && !isPrepare) throw new Error(`${atomId} 已经在进行中`);
  const keepStatus = isPrepare ? (options.keepStatus || atom.status) : null;
  // 准备流程只负责「想清楚」，不应该把原子本身的完成度推到 100%。
  const originalProgress = Number(atom.progress) || 0;

  const mentions = options.mentions || atom.mentions || [];
  const resolved = mentions.map(m => resolveMention(options.root || process.cwd(), m));
  const missing = resolved.filter(r => r.missing);

  const startedAt = new Date().toISOString();
  upsertRun(db, atomId, {
    phase: 'starting',
    status: 'starting',
    // 拖动触发时 spawnPreparation 已经建过 starting 记录并 +1，这里不再重复计数。
    bumpAttempt: !options.attemptBumped,
    ...(options.attemptBumped
      ? { message: '准备流程已接管，正在连接 Codex…' }
      : {
        label: resolved.map(r => `@${r.name}`).join(' ') || '（无 mention）',
        message: '正在准备执行环境…',
      }),
    error: '',
    last_activity: startedAt,
    started_at: startedAt,
    finished_at: null,
  });

  addEvent(db, atomId, 'run_start', 'board',
    `开始执行：${resolved.map(r => `@${r.name}`).join(' ') || '（无 mention）'}`,
    { resolved: resolved.map(r => ({ type: r.type, name: r.name, runner: r.runner, missing: !!r.missing })) });

  if (missing.length) {
    addEvent(db, atomId, 'error', 'board',
      `未找到执行目标：${missing.map(m => `@${m.name}`).join(', ')}（可用目标见 watomboard targets）`);
    if (!keepStatus) updateAtom(db, atomId, { status: 'blocked' });
    upsertRun(db, atomId, {
      phase: 'failed',
      status: 'failed',
      error: `未找到执行目标：${missing.map(m => `@${m.name}`).join(', ')}`,
      message: '执行前置检查未通过',
      last_activity: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
    return { ok: false, reason: 'missing-target', missing: missing.map(m => m.name) };
  }

  // 准备流程不改变所在列，只推进进度条；普通执行才会把原子拉到「进行中」。
  if (keepStatus) updateAtom(db, atomId, { progress: 5 });
  else updateAtom(db, atomId, { status: 'in_progress', progress: 5 });

  const root = options.root || process.cwd();
  const project = getProject(db, atom.project_id);
  const cfg = options.config || readConfig(root);
  const workspace = options.workspace || atom.workspace || atomFolder(root, atom, project, cfg);
  ensureDir(workspace);
  updateAtom(db, atomId, { workspace });

  // 项目知识库：同一项目的 Atom 共享项目目录；Codex 用 --add-dir 获得读取/写入能力。
  const projectDir = project ? ensureDir(projectFolder(root, project, cfg)) : null;

  const prompt = buildPrompt(atom, resolved, {
    notes: options.notes || [],
    workspace,
    projectDir,
    extraPrompt: options.extraPrompt || '',
    extraSkills: options.extraSkills || [],
  });
  const plan = buildCommand(resolved, prompt, { ...options, workspace, addDirs: [projectDir] });

  upsertRun(db, atomId, {
    phase: 'running',
    status: 'running',
    label: options.label || plan.label,
    message: '执行体已启动，正在处理…',
    last_activity: new Date().toISOString(),
  });

  addEvent(db, atomId, 'run_start', 'board', `执行体：${plan.label}`, { cmd: plan.cmd, jsonl: plan.jsonl });

  const depth = Number(process.env.ATOMBOARD_DEPTH || 0);
  const started = Date.now();
  let finalText = '';
  let sawTurnCompleted = false;
  let progress = 5;
  let rawOut = '';

  const child = spawn(plan.cmd, plan.args, {
    cwd: workspace,
    shell: plan.shell,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1', ATOMBOARD_DEPTH: String(depth + 1), ATOMBOARD_ATOM: atomId, ATOMBOARD_ROOT: options.root || process.cwd() },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (plan.stdin) {
    try { child.stdin.write(plan.stdin); child.stdin.end(); } catch { /* ignore */ }
  } else {
    child.stdin.end();
  }

  let buffer = '';
  const handle = (line) => {
    const ev = parseEventLine(line);
    if (!ev) return;
    switch (ev.type) {
      case 'thread.started':
        updateAtom(db, atomId, { thread_id: ev.thread_id });
        addEvent(db, atomId, 'thread', 'codex', `会话 ${ev.thread_id}`, { thread_id: ev.thread_id });
        upsertRun(db, atomId, {
          phase: 'running',
          status: 'running',
          message: '会话已建立，正在执行…',
          last_activity: new Date().toISOString(),
        });
        break;
      case 'turn.started':
        addEvent(db, atomId, 'turn', 'codex', '开始回合');
        upsertRun(db, atomId, {
          phase: 'running',
          status: 'running',
          message: '正在思考与执行…',
          last_activity: new Date().toISOString(),
        });
        break;
      case 'item.completed':
      case 'item.started': {
        const s = summarizeItem(ev.item);
        if (!s) break;
        if (s.kind === 'message') {
          finalText = s.text || finalText;
          addEvent(db, atomId, 'output', 'codex', trim(s.text, 4000), { raw: s.text });
          progress = Math.max(progress, 85);
          upsertRun(db, atomId, {
            phase: 'running', status: 'running',
            message: trim(s.text, 160) || '正在输出结论…',
            last_activity: new Date().toISOString(),
          });
        } else if (s.kind === 'reasoning') {
          if (s.text) addEvent(db, atomId, 'thinking', 'codex', trim(s.text, 600));
          progress = Math.max(progress, 30);
          upsertRun(db, atomId, {
            phase: 'running', status: 'running',
            message: '正在推理…',
            last_activity: new Date().toISOString(),
          });
        } else if (s.kind === 'command') {
          addEvent(db, atomId, 'command', 'codex', trim(s.text, 500), { exit: s.exit });
          progress = Math.max(progress, 45);
          upsertRun(db, atomId, {
            phase: 'running', status: 'running',
            message: `执行命令：${trim(s.text, 120)}`,
            last_activity: new Date().toISOString(),
          });
        } else if (s.kind === 'file') {
          addEvent(db, atomId, 'file', 'codex', trim(s.text, 300), {
            files: s.paths || [],
            changes: s.changes || undefined,
          });
          upsertRun(db, atomId, {
            phase: 'running', status: 'running',
            message: `写入文件：${trim(s.text, 120)}`,
            last_activity: new Date().toISOString(),
          });
        } else if (s.kind === 'todo') {
          const p = progressFromTodos(s.todos);
          if (p !== null) progress = Math.max(progress, p);
          addEvent(db, atomId, 'plan', 'codex', describeTodos(s.todos), { todos: s.todos });
          upsertRun(db, atomId, {
            phase: 'running', status: 'running',
            message: `计划进度：${s.todos.filter(x => x.status === 'completed').length}/${s.todos.length}`,
            last_activity: new Date().toISOString(),
          });
        } else if (s.kind === 'error') {
          addEvent(db, atomId, 'error', 'codex', trim(s.text, 1000));
          upsertRun(db, atomId, {
            phase: 'running', status: 'running',
            error: trim(s.text, 300),
            last_activity: new Date().toISOString(),
          });
        } else if (s.kind === 'tool') {
          addEvent(db, atomId, 'tool', 'codex', trim(s.text, 300));
          upsertRun(db, atomId, {
            phase: 'running', status: 'running',
            message: `调用工具：${trim(s.text, 120)}`,
            last_activity: newDateSafe(),
          });
        }
        updateAtom(db, atomId, { progress });
        break;
      }
      case 'turn.completed':
        sawTurnCompleted = true;
        addEvent(db, atomId, 'usage', 'codex', '回合结束', { usage: ev.usage });
        upsertRun(db, atomId, {
          phase: 'running', status: 'running',
          message: '回合结束，等待收尾…',
          last_activity: new Date().toISOString(),
        });
        break;
      case 'turn.failed':
      case 'error':
        addEvent(db, atomId, 'error', 'codex', trim(ev.message || JSON.stringify(ev), 1000));
        upsertRun(db, atomId, {
          phase: 'running', status: 'running',
          error: trim(ev.message || JSON.stringify(ev), 300),
          last_activity: new Date().toISOString(),
        });
        break;
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    rawOut += chunk;
    if (!plan.jsonl) return;
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      handle(line);
    }
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const exitCode = await new Promise((resolve) => {
    child.on('error', (err) => resolve({ code: -1, spawnError: err }));
    child.on('close', (code) => resolve({ code }));
  });

  if (buffer.trim()) handle(buffer);

  // 非 JSONL 执行体：整段输出作为一条 output 事件
  if (!plan.jsonl && rawOut.trim()) {
    finalText = rawOut.trim();
    addEvent(db, atomId, 'output', 'codex', trim(finalText, 8000), { raw: finalText });
  }

  const durationMs = Date.now() - started;
  const failed = exitCode.code !== 0 || exitCode.spawnError;

  if (failed) {
    addEvent(db, atomId, 'error', 'board',
      `执行失败（退出码 ${exitCode.code}）${exitCode.spawnError ? ': ' + exitCode.spawnError.message : ''}`,
      { stderr: trim(stderr, 2000) });
    if (keepStatus) updateAtom(db, atomId, { progress: originalProgress });
    else updateAtom(db, atomId, { status: 'blocked', progress });
    upsertRun(db, atomId, {
      phase: 'failed',
      status: 'failed',
      error: trim(exitCode.spawnError ? exitCode.spawnError.message : stderr || `退出码 ${exitCode.code}`, 500),
      message: `执行失败（退出码 ${exitCode.code}）`,
      last_activity: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
  } else {
    let statusReverted = false;
    if (keepStatus) {
      // 准备流程运行期间，用户可能已经把卡片拖到别的列。
      // 这时绝不能把状态改回启动时的旧列，否则会覆盖用户更新。
      const fresh = getAtom(db, atomId);
      if (fresh && fresh.status === keepStatus) {
        updateAtom(db, atomId, { status: keepStatus, progress: originalProgress });
      } else {
        statusReverted = true;
        updateAtom(db, atomId, { progress: originalProgress });
      }
    } else {
      updateAtom(db, atomId, { status: 'in_review', progress: 100 });
    }
    upsertRun(db, atomId, {
      phase: 'done',
      status: 'done',
      error: '',
      message: keepStatus
        ? (statusReverted ? '准备流程完成，保留拖动后的最新状态' : '准备流程完成，状态保持不变')
        : '执行完成，已进入待验收',
      last_activity: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
    addEvent(db, atomId, 'status', 'board',
      keepStatus
        ? `准备流程完成（${statusReverted ? '状态已更新，未回退' : (sawTurnCompleted ? '回合正常结束' : '进程正常结束')}）`
        : (sawTurnCompleted ? '执行完成，进入待验收' : '进程结束，进入待验收'),
      { durationMs, keepStatus, statusReverted });
  }

  addEvent(db, atomId, 'run_end', 'board',
    `执行结束，用时 ${(durationMs / 1000).toFixed(1)}s`, { durationMs, exitCode: exitCode.code });

  return {
    ok: !failed,
    exitCode: exitCode.code,
    durationMs,
    output: finalText,
    stderr: trim(stderr, 2000),
  };
}

function describeTodos(todos) {
  if (!Array.isArray(todos)) return '';
  return todos.map(t => `[${t.status === 'completed' ? 'x' : ' '}] ${t.text || t.title || ''}`).join('\n');
}

function trim(text, max = 500) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function newDateSafe() {
  try { return new Date().toISOString(); } catch { return null; }
}
