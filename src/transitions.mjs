import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { addEvent, getAtom, getRun, upsertRun } from './store.mjs';
import { labelOf } from './model.mjs';

/**
 * 状态转换规则（拖动逻辑）
 * 每条规则描述：从某个状态拖到某个状态时，系统该做什么。
 *   title    —— 这次转换的名字（看板上显示）
 *   prompt   —— 追加给 Codex 的提示词
 *   skills   —— 允许调用的 Codex 技能（注入为 $技能名）
 *   auto     —— 进入该状态时是否自动跑一次「准备流程」
 *
 * 默认规则中，主干路径（想法→待办→进行中→待评审→完成）会自动执行一次准备流程；
 * 回退/受阻类路径默认只记录规则，不自动消耗 Codex，可在系统设置里逐条打开。
 */
export const DEFAULT_TRANSITIONS = {
  version: 2,
  rules: [
    {
      from: 'idea', to: 'todo', enabled: true, auto: true,
      title: '选题立项',
      prompt: [
        '本轮目标：把这个灵感整理成一个可以动笔的写作任务。本轮不写正文。',
        '',
        '请完成：',
        '1. 用一句话重述这个选题，说明读者读完能获得什么；',
        '2. 给出 2～3 条切入角度（叙事 / 论证 / 结构 / 案例），写清各自的长处与风险；',
        '3. 推荐一条角度，标出它依赖的关键假设与最容易写偏的地方；',
        '4. 写出这篇的写作提纲（3～6 个小节，每节一句话）与目标字数；',
        '5. 列出写作前必须由用户确认的问题，最多 3 个。',
        '',
        '输出格式：选题一句话 / 读者收益 / 角度候选 / 推荐角度 / 提纲 / 目标字数 / 待确认问题。',
        '不要自行编造事实、案例或数据；素材不足就明确标出缺口。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'todo', to: 'in_progress', enabled: true, auto: true,
      title: '动笔确认',
      prompt: [
        '本轮目标：确认这一篇可以动笔，并把写作边界钉死。',
        '',
        '请完成：',
        '1. 复述选题、读者与目标字数；',
        '2. 明确「这一篇不写什么」，以及不能改动的既有稿件范围；',
        '3. 判断素材、事实依据、语气约定是否齐全；',
        '4. 给出写作顺序（先哪一节）、每个小节的预计字数与产出文件名。',
        '',
        '输出格式：选题 / 读者 / 目标字数 / 不写什么 / 素材缺口 / 写作顺序与文件。',
        '若素材缺失，直接指出缺什么，不要假装可以开写。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'in_progress', to: 'in_review', enabled: true, auto: true,
      title: '交稿自检',
      prompt: [
        '本轮目标：在进入待审校前，对这一篇稿件做一次交稿自检。',
        '',
        '请完成：',
        '1. 列出产出稿件文件（相对路径）与实际字数；',
        '2. 对照提纲，说明每一节是否写到、写到什么程度；',
        '3. 标注出弱的部分（论述空、例子单薄、逻辑跳跃）与未完成段落；',
        '4. 列出需要用户决策的问题（观点、语气、事实取舍）。',
        '',
        '输出格式：稿件清单 / 提纲对照 / 弱项清单 / 待决策问题。',
        '不要用「已完成」代替证据；没写到的地方明确写没写到。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'in_review', to: 'done', enabled: true, auto: true,
      title: '审校定稿',
      prompt: [
        '本轮目标：决定这一篇能否定稿。',
        '',
        '请逐条对照最初的选题、提纲与目标字数：',
        '1. 每条给出「通过 / 部分通过 / 不通过」；',
        '2. 通过项必须引用稿件原文片段作为证据；',
        '3. 任一关键项缺证据，就判定为不通过并说明最小补写动作；',
        '4. 最后给出结论：可以定稿 / 退回写作中。',
        '',
        '不要为了让稿件定稿而放宽标准。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'in_progress', to: 'blocked', enabled: true, auto: false,
      title: '卡文诊断',
      prompt: [
        '本轮目标：定位写不下去的卡点，并给出最小解阻动作。',
        '',
        '请判断属于哪一类：素材缺失 / 观点未立 / 结构混乱 / 事实存疑 / 篇幅失控。',
        '然后写清：',
        '1. 卡在哪一节、哪一句，已经尝试过什么写法；',
        '2. 解除卡壳所需的最小条件（一段素材 / 一个决定 / 一次换角度）；',
        '3. 用户可以做什么决定来解开它；',
        '4. 阻塞解除后的下一步。',
        '',
        '不要用堆字数的方式绕过卡壳；先解决卡壳本身。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'todo', to: 'blocked', enabled: true, auto: false,
      title: '动笔前受阻',
      prompt: [
        '本轮目标：记录这一篇为什么还不能动笔。',
        '',
        '请列出缺失的前置条件：',
        '1. 缺素材、缺背景、缺方向，还是选题本身太虚；',
        '2. 每项标注负责人或来源；',
        '3. 给出恢复动笔的最小动作；',
        '4. 如果只是暂时不想写，明确写出「暂缓」而不是「卡文」。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'blocked', to: 'in_progress', enabled: true, auto: true,
      title: '解除卡文',
      prompt: [
        '本轮目标：确认卡文已经解开，并恢复写作。',
        '',
        '请完成：',
        '1. 重述原来的卡点，以及这次靠什么解开；',
        '2. 确认选题与提纲没有变化；',
        '3. 重述接下来的写作顺序与预计字数；',
        '4. 如果卡点其实还在，明确反对进入写作中。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'in_review', to: 'in_progress', enabled: true, auto: true,
      title: '审校驳回',
      prompt: [
        '本轮目标：把审校未通过的部分退回写作。',
        '',
        '请完成：',
        '1. 逐条列出审校未通过的项；',
        '2. 说明缺的是素材、论证还是结构；',
        '3. 给出最小返工方案（改哪几段、目标字数）；',
        '4. 标出不需要重写的部分，避免整篇重写。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'in_progress', to: 'todo', enabled: true, auto: false,
      title: '暂停与回退',
      prompt: [
        '本轮目标：暂停这一篇的写作，并留下可恢复的入口。',
        '',
        '请完成：',
        '1. 总结已写完的部分和当前字数；',
        '2. 说明暂停原因（素材不足、方向变化、优先级等）；',
        '3. 列出恢复写作时的第一动作；',
        '4. 保留已有稿件，不要删除或回滚历史。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'done', to: 'in_progress', enabled: true, auto: false,
      title: '重开修订',
      prompt: [
        '本轮目标：重新打开一篇已定稿的文章，并控制修订范围。',
        '',
        '请完成：',
        '1. 说明重开原因，区分勘误补漏与新增扩写；',
        '2. 列出本次要改的段落与不动的部分；',
        '3. 更新目标字数，避免与原标准混淆；',
        '4. 给出第一步修订动作。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'done', to: 'todo', enabled: true, auto: false,
      title: '重新排期',
      prompt: [
        '本轮目标：保留已定稿成果，为后续扩写重新排期。',
        '',
        '请完成：',
        '1. 明确哪些段落继续有效；',
        '2. 列出新的待写范围与优先级；',
        '3. 说明为什么现在不做、计划何时做；',
        '4. 不要删除原定稿记录。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'in_review', to: 'blocked', enabled: true, auto: false,
      title: '审校阶段卡文',
      prompt: [
        '本轮目标：记录审校阶段卡住的原因。',
        '',
        '请写清：',
        '1. 缺哪份素材或哪个判断；',
        '2. 在等什么；',
        '3. 在卡点解除前不动哪些内容；',
        '4. 最小解阻动作与预计恢复时间。',
      ].join('\n'),
      skills: [],
    },
    {
      from: 'todo', to: 'idea', enabled: true, auto: false,
      title: '退回灵感',
      prompt: [
        '本轮目标：判断这个选题是否真的准备好，若没有则退回灵感。',
        '',
        '请完成：',
        '1. 指出选题里尚未坐实的关键假设；',
        '2. 说明为什么现在排期会写废；',
        '3. 列出需要先想清楚或先查证的 1～3 个问题；',
        '4. 给出验证这些问题的最小动作。',
      ].join('\n'),
      skills: [],
    },
  ],
};

export function transitionsPath(root) {
  return path.join(root, 'data', 'transitions.json');
}

export function readTransitions(root) {
  const file = transitionsPath(root);
  if (!existsSync(file)) return structuredClone(DEFAULT_TRANSITIONS);
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!parsed || !Array.isArray(parsed.rules)) return structuredClone(DEFAULT_TRANSITIONS);
    const known = new Set(parsed.rules.map(r => `${r.from}>${r.to}`));
    for (const d of DEFAULT_TRANSITIONS.rules) {
      if (!known.has(`${d.from}>${d.to}`)) parsed.rules.push(structuredClone(d));
    }
    return parsed;
  } catch {
    return structuredClone(DEFAULT_TRANSITIONS);
  }
}

export function writeTransitions(root, data) {
  const file = transitionsPath(root);
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

export function findRule(root, from, to) {
  return readTransitions(root).rules.find(r => r.from === from && r.to === to) || null;
}

/**
 * 判断一条执行记录是否还「活着」。
 * - starting 超过 60 秒还没接管 → 视为启动失败（子进程没起来）
 * - running 超过 60 分钟没有任何活动 → 视为失联
 * 这样即使上次执行体崩了，也不会永远挡住下一次拖动。
 */
export function isRunStale(run, now = Date.now()) {
  if (!run || !['starting', 'running'].includes(run.status)) return false;
  const raw = run.last_activity || run.updated_at || run.started_at;
  const ts = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(ts)) return true;
  const limit = run.status === 'starting' ? 60 * 1000 : 60 * 60 * 1000;
  return now - ts > limit;
}

export function applyTransition(db, root, atomId, from, to, { trigger = 'ui', background = true, spawnImpl } = {}) {
  const atom = getAtom(db, atomId);
  if (!atom) return { ok: false, error: 'atom 不存在' };
  if (from === to) return { ok: true, rule: null, skipped: 'same-status' };

  addEvent(db, atomId, 'status', trigger, `状态 ${labelOf(from)} → ${labelOf(to)}`, { from, to });

  const rule = findRule(root, from, to);
  if (!rule || !rule.enabled) return { ok: true, rule: null };

  const skills = (rule.skills || []).filter(Boolean);
  addEvent(
    db, atomId, 'plan', 'system',
    `进入「${labelOf(to)}」触发准备流程：${rule.title || `${from} → ${to}`}` +
    (skills.length ? `（技能：${skills.map(s => '$' + s).join(' ')}）` : ''),
    { rule }
  );

  let spawned = null;
  let skipped = null;
  if (rule.auto && background) {
    const active = getRun(db, atomId);
    if (active && ['starting', 'running'].includes(active.status)) {
      if (isRunStale(active)) {
        upsertRun(db, atomId, {
          phase: 'failed',
          status: 'failed',
          error: '执行体已失联（长时间没有活动）',
          message: '上一次执行已失联，已清理并允许重新启动',
          last_activity: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        });
        addEvent(
          db, atomId, 'error', 'system',
          '上一次执行体已失联，自动清理后重新触发准备流程'
        );
        spawned = spawnPreparation(db, root, atom, rule, { spawnImpl });
      } else {
        skipped = 'already-running';
        addEvent(
          db, atomId, 'plan', 'system',
          '该原子已有执行体在运行，本次拖动只更新状态，不重复启动 Codex',
          { run_status: active.status }
        );
      }
    } else {
      spawned = spawnPreparation(db, root, atom, rule, { spawnImpl });
    }
  }

  return { ok: true, rule, spawned, skipped };
}

/**
 * 启动一次「准备流程」执行体。
 *
 * 关键点：
 * - 先写 runs(phase=starting)，让前端立刻看到「正启动」，而不是等子进程起来。
 * - 子进程启动后由 runner 接管，把 starting → running → done/failed。
 * - --keep-status 让准备流程结束后保留拖动到的列，不会被 runner 改成「待验收」。
 */
export function spawnPreparation(db, root, atom, rule, { spawnImpl = spawn } = {}) {
  const ts = new Date().toISOString();
  const keepStatus = atom.status;
  const ruleTitle = rule.title || `${atom.status}`;

  // 自动化开关：测试或批量导入时可用 ATOMBOARD_AUTORUN=0 只记录状态，不启动 Codex。
  if (process.env.ATOMBOARD_AUTORUN === '0') {
    addEvent(db, atom.id, 'plan', 'system', `自动执行已关闭，跳过准备流程：${ruleTitle}`);
    return { disabled: true };
  }

  upsertRun(db, atom.id, {
    phase: 'starting',
    status: 'starting',
    bumpAttempt: true,
    label: ruleTitle,
    message: '已触发准备流程，正在启动 Codex…',
    error: '',
    started_at: ts,
    finished_at: null,
    last_activity: ts,
  });
  addEvent(db, atom.id, 'run_start', 'system', `启动准备流程：${ruleTitle}`, {
    from: rule.from, to: rule.to, keepStatus,
  });

  try {
    const child = spawnImpl(
      process.execPath,
      [path.join(root, 'bin', 'watomboard.mjs'), 'atom', 'run', atom.id,
        '--worker', '--prepare', encodeURIComponent(rule.prompt || ''),
        '--prepare-skills', encodeURIComponent((rule.skills || []).join(',')),
        '--keep-status', keepStatus, '--run-label', ruleTitle, '--run-prepared'],
      { cwd: root, detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref?.();
    return { pid: child.pid };
  } catch (e) {
    upsertRun(db, atom.id, {
      phase: 'failed',
      status: 'failed',
      error: e.message,
      message: '准备流程启动失败',
      last_activity: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
    addEvent(db, atom.id, 'error', 'system', `准备流程启动失败：${e.message}`);
    return { error: e.message };
  }
}
