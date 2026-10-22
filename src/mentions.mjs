import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();

/** @codex  @skill:xxx  @agent:xxx  @name(裸技能名) */
const MENTION_RE = /@([a-zA-Z一-龥][\w一-龥:.-]*)/g;

export function parseMentions(text) {
  const found = [];
  const seen = new Set();
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(String(text || ''))) !== null) {
    const raw = m[0];
    const token = m[1];
    const lower = token.toLowerCase();
    let type, name;
    if (lower === 'codex') { type = 'codex'; name = 'codex'; }
    else if (lower.startsWith('skill:')) { type = 'skill'; name = token.slice(6); }
    else if (lower.startsWith('agent:')) { type = 'agent'; name = token.slice(6); }
    else { type = 'skill'; name = token; }
    if (!name) continue;
    const key = `${type}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ type, name, raw });
  }
  return found;
}

export function skillSearchPaths() {
  return [
    path.join(HOME, '.codex', 'skills'),
    path.join(HOME, '.agents', 'skills'),
    path.join(HOME, '.codex', 'plugins', 'cache'),
    path.join(process.cwd(), 'skills'),
    path.join(process.cwd(), '.codex', 'skills'),
  ];
}

/** 找到技能定义文件（skills/<name>/SKILL.md） */
export function findSkill(name) {
  const target = name.toLowerCase();
  for (const base of skillSearchPaths()) {
    if (!existsSync(base)) continue;
    let entries;
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(base, e.name);
      const skillFile = path.join(full, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      if (e.name.toLowerCase() === target) {
        return { name: e.name, file: skillFile, base: full };
      }
    }
  }
  return null;
}

/** 读取 skill 的 description（首部 front matter） */
export function skillMeta(file) {
  try {
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return { description: firstLine(text) };
    const meta = {};
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return { description: meta.description || '', name: meta.name || '', body: text };
  } catch {
    return { description: '' };
  }
}

function firstLine(text) {
  const line = String(text).split(/\r?\n/).find(l => l.trim() && !l.startsWith('#'));
  return (line || '').trim().slice(0, 120);
}

/**
 * Agent 定义来源（按优先级）：
 *   1. 项目内 watomboard.agents.json / agents.json
 *   2. ~/.watomboard/agents.json
 * 形如：[{ "name": "reviewer", "cmd": "claude", "args": ["-p"], "prompt": "..." }]
 */
export function agentDefinitions(root) {
  const candidates = [
    path.join(process.cwd(), 'watomboard.agents.json'),
    path.join(process.cwd(), 'agents.json'),
    path.join(root, 'agents.json'),
    path.join(HOME, '.watomboard', 'agents.json'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const list = Array.isArray(parsed) ? parsed : (parsed.agents || []);
      if (list.length) return { file, list };
    } catch { /* ignore broken config */ }
  }
  return { file: null, list: [] };
}

export function findAgent(root, name) {
  const { list } = agentDefinitions(root);
  return list.find(a => String(a.name).toLowerCase() === name.toLowerCase()) || null;
}

/** 列出所有可用的 @ 目标 */
export function listTargets(root) {
  const out = [{ type: 'codex', name: 'codex', description: '默认 Codex 执行体' }];
  const seen = new Set();
  for (const base of skillSearchPaths()) {
    if (!existsSync(base)) continue;
    let entries;
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || seen.has(e.name.toLowerCase())) continue;
      const skillFile = path.join(base, e.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      seen.add(e.name.toLowerCase());
      out.push({ type: 'skill', name: e.name, description: skillMeta(skillFile).description });
    }
  }
  const { list } = agentDefinitions(root);
  for (const a of list) {
    out.push({ type: 'agent', name: a.name, description: a.description || `自定义 agent (${a.cmd || 'codex'})` });
  }
  return out;
}

/**
 * 把 mention 解析成可执行的执行体描述。
 * 返回 { type, name, runner, prompt?, skillFile?, agent? }
 */
export function resolveMention(root, mention) {
  if (mention.type === 'codex') {
    return { type: 'codex', name: 'codex', runner: 'codex' };
  }
  if (mention.type === 'agent') {
    const agent = findAgent(root, mention.name);
    if (agent) return { type: 'agent', name: mention.name, runner: (agent.cmd && !/^codex(\.exe)?$/i.test(agent.cmd)) ? 'custom' : 'codex', agent };
    const skill = findSkill(mention.name);
    if (skill) return { type: 'agent', name: mention.name, runner: 'codex', skillFile: skill.file, fallbackSkill: true };
    return { type: 'agent', name: mention.name, runner: 'codex', missing: true };
  }
  const skill = findSkill(mention.name);
  if (skill) return { type: 'skill', name: skill.name, runner: 'codex', skillFile: skill.file };
  const agent = findAgent(root, mention.name);
  if (agent) return { type: 'agent', name: agent.name, runner: (agent.cmd && !/^codex(\.exe)?$/i.test(agent.cmd)) ? 'custom' : 'codex', agent };
  return { type: 'skill', name: mention.name, runner: 'codex', missing: true };
}
