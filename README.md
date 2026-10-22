# W-AtomBoard

**写作原子看板**：一本书当作一个项目，一个选题或一章当作一个 Atom。
把 Atom 指派给 `@codex`、`@skill` 或自定义 Agent 去写；正文落盘到它自己的目录，
字数、时间线与成果实时回写看板，并与**得到大脑**笔记互通。

本地优先、运行时零 npm 依赖（Node 内置 `node:sqlite`），数据全部留在你自己的机器上。

[![CI](https://github.com/jeekeagle/W-AtomBoard/actions/workflows/ci.yml/badge.svg)](https://github.com/jeekeagle/W-AtomBoard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5-black.svg)](package.json)

---

## 它解决什么问题

大多数写作工具在管理**信息**：标题、标签、大纲、备注。
W-AtomBoard 管理的是**稿件**：每个 Atom 有目标字数、有工作目录、有执行体、有正文文件、有可回溯的时间线。

```
idea（灵感）→ todo（待写）→ in_progress（写作中）→ in_review（待审校）→ done（定稿）
                                  ↘ blocked（卡文） ↗
```

- 执行体只能把 Atom 推进到 `in_review`；`done`（定稿）必须由人确认。
- 字数不是手动填的：看板扫描 Atom 目录里的真实 Markdown/文本文件。
- 每次状态变化、每次 Codex 动笔、每次稿件产出，都会进入时间线。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| **写作看板** | 灵感 / 待写 / 写作中 / 卡文 / 待审校 / 定稿；卡片可横向拖拽改状态 |
| **字数度量** | 目标字数写在 Atom 上，已写字数从 `draft.md` 等正文文件实时统计 |
| **全书稿** | 按章节顺序把各 Atom 正文拼成一份 Markdown，导出到 `manuscript/` |
| **执行** | 调用本地 `codex exec --json`，把命令、思考、输出、报错逐条写入时间线 |
| **项目工作区** | 每个项目一个目录，每个 Atom 一个子目录；正文与素材分离 |
| **成果阅读** | 全屏详情：左侧信息与时间线 / 中间 Markdown 阅读 / 右侧成果列表 |
| **信息本体** | `ontology/WATOMBOARD.md` 定义实体、字段、状态机、写作度量；所有 Agent 读同一份契约 |
| **全局 Log** | `logs/events.jsonl` 只追加，是所有 Agent 共享的事实来源 |
| **得到大脑** | 每个项目对应知识库 `WATOM-<项目名>`，可检索、关联、回存 |
| **可配置** | Codex 路径与模型、风格主题、状态流转提示词与技能 |
| **三种入口** | Web 看板、`watomboard` CLI、Codex Skill（`skills/w-atomboard`） |

## 快速开始

环境要求：**Node.js ≥ 24**（需要内置 `node:sqlite`）。

```bash
git clone https://github.com/jeekeagle/W-AtomBoard.git
cd W-AtomBoard

node bin/watomboard.mjs init
node bin/watomboard.mjs project add "我的第一本书" --desc "写给谁、解决什么问题"
node bin/watomboard.mjs atom new 我的第一本书 --title "第一章：为什么写" --body "写作要求" --word-goal 3000 --mention @codex
node bin/watomboard.mjs serve --port 7789
```

打开 <http://127.0.0.1:7789>。

也可以全局安装命令：

```bash
npm link
watomboard serve
```

## 常用命令

```bash
# 一本书
watomboard project add <书名> [--desc 描述] [--key key]
watomboard project archive <key>
watomboard project delete <key> [--move-to key]
watomboard project export <key> [--status in_review,done]

# 选题 / 章节
watomboard atom new <项目> --title "章节名" [--body 写作要求] [--target 交付目标] [--word-goal 3000] [--mention @codex]
watomboard atom words <AT-1> [字数]              # 查看 / 设置目标字数
watomboard atom stats <项目>                     # 项目写作统计
watomboard atom move <AT-1> <status>             # 改状态
watomboard atom run <AT-1> [--background]        # 交给 Codex 动笔
watomboard atom log <AT-1> "手动记录一条事件"
watomboard atom push <AT-1>                      # 稿件写回得到大脑

watomboard board                                 # 终端看板
watomboard state                                 # 状态快照
watomboard log --tail 40                         # 全局事件流
watomboard config --test                         # 测试本地 Codex 连接
watomboard doctor                                # 自检
```

完整命令：`watomboard --help`。

## 磁盘约定

```
workspaces/
  我的第一本书/
    manuscript/
      全书稿-2026-10-22.md
    AT-1 第一章：为什么写/
      draft.md            正文（字数来源）
      素材/               素材、访谈、参考（不计字数）
```

- 正文只认 `.md` / `.markdown` / `.txt`；默认写 `draft.md`。
- `素材/`、`资料/`、`参考/`、`notes/`、`materials/`、`references/` 不计入字数。
- 项目知识库固定在得到大脑里，命名 `WATOM-<项目名>`。

## Web 看板

- 顶部是项目筛选条；右上角只有「系统设置」一个入口。
- 灵感 / 待写 / 写作中三列右上角的 `+` 可以直接新建选题。
- 点击卡片打开全屏详情：左侧信息与时间线，中间阅读稿件，右侧成果列表。
- 时间线以事件为中心，最新在上；过程细节收进所属里程碑。
- 左下角是进度抽屉：哪些 Atom 在写、写到哪一步、是否失败。
- 左下角录音按钮：说一段话，由 Agent 解析成选题草稿。

深链：`?atom=AT-1`、`?cfg=1`、`?still=1`（关闭动画，截图用）。

## 执行体

| 写法 | 含义 |
| --- | --- |
| `@codex` | 默认执行体，调用本地 Codex CLI |
| `@skill:<名字>` | 指定 Codex 技能，注入为 `$<名字>` |
| `@agent:<名字>` | 自定义 Agent，定义在 `agents.json`（内置 `editor` / `researcher` / `plot-doctor` / `note-writer`） |

一次 `atom run` 的流程：

1. 解析 mention，定位执行体与技能；
2. 组装 prompt（选题 + 写作要求 + 交付目标 + 目标字数 + 指定技能 + 得到大脑上下文 + 执行边界）；
3. 启动 `codex exec --json`，逐条解析 JSONL 事件；
4. 把命令、输出、思考、报错写入时间线与全局 Log；
5. 扫描 Atom 目录，登记稿件与素材文件；
6. 推进状态与进度，等待人工审校。

### 安全阀

| 机制 | 作用 |
| --- | --- |
| 递归保护 | 执行体内部再次调用 `watomboard atom run` 会被拒绝（`ATOMBOARD_DEPTH`） |
| 执行边界 | prompt 明确禁止执行 watomboard 命令、禁止改动看板自身数据库 |
| 写入范围 | 执行体被限制在 Atom 工作目录内写文件 |
| 状态推进 | 执行体最多推进到 `in_review`，`done` 由人确认 |

## 配置

配置优先级：项目 `data/config.json` → 全局 `~/.watomboard/config.json` → 默认值。

```bash
watomboard config                                   # 查看
watomboard config --model <模型> --sandbox read-only --port 7789
watomboard config --test                            # 真实跑一次最小 codex exec
watomboard style --theme white --style editorial    # 风格与主题
watomboard transitions                              # 状态流转规则（拖动逻辑）
```

风格规范存放在 `styles/*.md`，注册表在 `styles/registry.json`。
默认风格为 **Editorial（编辑杂志风）**，默认主题为 **White（白色）**。

## 得到大脑互操作

```bash
watomboard note search "大模型" --limit 5
watomboard atom link AT-1 --note <笔记ID>
watomboard atom push AT-1
watomboard atom run AT-1 --note-query "相关背景"
```

底层调用已登录的 `getnote` CLI，不额外引入 SDK。

## 目录结构

```
bin/watomboard.mjs        CLI 入口
src/brand.mjs             品牌与端口、数据库名
src/store.mjs            SQLite：projects / atoms / events / links / runs
src/model.mjs            状态机与字段定义
src/writing.mjs          字数统计、稿件收集、全书稿拼接与导出
src/transitions.mjs      拖动逻辑：状态变化时触发的提示词与技能
src/runner.mjs           codex exec --json → 进度回写
src/artifacts.mjs        成果文件扫描与元数据
src/workspaces.mjs       项目 / Atom 工作目录（含 素材/）
src/projectResources.mjs 项目资源聚合（本地文件 + 得到大脑）
src/getnote.mjs          得到大脑桥接
src/server.mjs           HTTP + SSE
src/ontology.mjs         信息本体
src/logbook.mjs          全局 Log 投影
src/timeline.mjs         事件流 → 时间线
web/                     看板与 Markdown 阅读页
skills/w-atomboard/      给 Codex 用的技能包
ontology/                信息本体产物
styles/                  风格规范
tests/                   node:test 回归测试
docs/                    文档与截图
```

运行时会生成（已被 `.gitignore` 排除）：`data/`、`workspaces/`、`logs/`、`book/`。

## 作为 Codex 技能使用

```bash
mkdir -p ~/.codex/skills/w-atomboard
cp skills/w-atomboard/SKILL.md ~/.codex/skills/w-atomboard/
```

之后在 Codex 里说「在 W-AtomBoard 上建个选题」「这一章写了多少字」「导出全书稿」，
Codex 会自动使用该技能操作看板。

## 测试

```bash
npm test
node --test tests/model.test.mjs   # 单个文件
```

测试使用 Node 内置 `node:test`，全部在临时目录里建自己的 SQLite 与工作区，
不会碰真实的 `data/watomboard.db` 与 `data/config.json`。

## 许可证

[MIT](LICENSE)
