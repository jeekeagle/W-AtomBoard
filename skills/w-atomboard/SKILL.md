---
name: w-atomboard
description: 操作 W-AtomBoard（写作原子看板）—— 一本书一个 Project，一个选题/章节一个 Atom。当用户提到 W-AtomBoard、写作看板、选题、章节、Atom、新建选题、字数、目标字数、导出书稿、@codex 写作、把稿件同步到得到大脑，或要求把写作进度记录到看板时使用。先读本体与状态快照，再操作；正文落盘到 Atom 目录，状态与字数回写看板。
---

# W-AtomBoard（写作版）

W-AtomBoard 是一个本地优先的写作看板：**一本书 = 一个 Project，一个选题或一章 = 一个 Atom**。
每个 Atom 可以被指派给执行体（`@codex` / `@skill` / `@agent`），正文写到它自己的目录里，
看板从真实文件统计字数。

项目根目录：`D:\M-Local\codex\W-AtomBoard`
CLI：`node D:\M-Local\codex\W-AtomBoard\bin\watomboard.mjs <命令>`（全局命令 `watomboard`）
Web：`http://127.0.0.1:7789/`

## 动手之前：先读三份文件

这是所有 Agent 共用的契约与事实来源，**读它们比读代码更快**：

| 文件 | 作用 |
| --- | --- |
| `ontology/WATOMBOARD.md` | **信息本体**：实体、字段、状态机、写作度量、接口清单、约定 |
| `logs/STATE.md` | 当前状态快照：项目、选题、状态、字数、执行体 |
| `logs/LOG.md` | 全局事件流（可读版）；机读版 `logs/events.jsonl` |

```powershell
node bin\watomboard.mjs state
node bin\watomboard.mjs log --tail 40
```

`logs/events.jsonl` 是**只追加**的事实来源：所有 Agent 的写操作都在里面，
互相之间不需要额外沟通就能知道彼此做过什么。

## 核心概念

| 概念 | 说明 |
| --- | --- |
| Project | 一本书 / 一个专栏；`key` 是命令行可引用的短标识；同时是本地文件夹 |
| Atom | 选题或章节：`AT-1`、`AT-2`… 有状态、目标字数、提及、时间线 |
| Word goal | 目标字数；已写字数从 Atom 目录中的正文文件实时统计 |
| Mention | `@codex`、`@skill:<名字>`、`@agent:<名字>`，写在标题或描述里 |
| Event | 时间线条目：动笔、稿件产出、改状态、关联笔记（追加式，永不改写） |
| Link | Atom ↔ 得到大脑笔记 的关联 |

状态：`idea（灵感）→ todo（待写）→ in_progress（写作中）→ in_review（待审校）→ done（定稿）`，
另有 `blocked（卡文）`。**没有「取消」状态**，不要发明它。

## 磁盘约定

```
workspaces/<项目>/
  manuscript/                 全书稿（导出）
  <AT-1 标题>/
    draft.md                  正文（字数来源）
    素材/                     素材、访谈、参考（不计字数）
```

- 正文只能是 `.md` / `.markdown` / `.txt`；默认写 `draft.md`。
- 素材一律放 `素材/`，否则会被计入正文字数。
- 项目知识库：得到大脑中的 `WATOM-<项目名>`，同一项目的 Atom 都可以读。

## 常用命令

```powershell
cd D:\M-Local\codex\W-AtomBoard

# 一本书
node bin\watomboard.mjs project add "<书名>" --desc "<这本书写什么>"
node bin\watomboard.mjs project list [--all]
node bin\watomboard.mjs project archive <key>
node bin\watomboard.mjs project unarchive <key>
node bin\watomboard.mjs project delete <key> [--force] [--move-to <key>]
node bin\watomboard.mjs project export <key> [--status in_review,done]

# 选题 / 章节
node bin\watomboard.mjs atom new <项目key> --title "章节名" --body "写作要求" --target "交付目标" --word-goal 3000 --mention @codex
node bin\watomboard.mjs atom list --project <key>
node bin\watomboard.mjs atom show AT-1
node bin\watomboard.mjs atom words AT-1            # 查看已写 / 目标
node bin\watomboard.mjs atom words AT-1 3000       # 设目标字数
node bin\watomboard.mjs atom stats <项目key>       # 项目写作统计
node bin\watomboard.mjs atom move AT-1 in_progress
node bin\watomboard.mjs atom log AT-1 "写完第一节"
node bin\watomboard.mjs atom run AT-1              # 前台动笔
node bin\watomboard.mjs atom run AT-1 --background
node bin\watomboard.mjs atom run AT-1 --dry-run    # 只打印 prompt，不执行
node bin\watomboard.mjs atom link AT-1 --note <笔记ID>
node bin\watomboard.mjs atom push AT-1             # 稿件存成得到大脑笔记

# 看板 / 服务
node bin\watomboard.mjs board
node bin\watomboard.mjs serve --port 7789          # http://127.0.0.1:7789

# 本体与日志
node bin\watomboard.mjs ontology --print
node bin\watomboard.mjs log --tail 30
node bin\watomboard.mjs state

# 系统配置
node bin\watomboard.mjs config
node bin\watomboard.mjs config --model <模型> --sandbox read-only
node bin\watomboard.mjs config --test

# 得到大脑 / 自检
node bin\watomboard.mjs note search "关键词" --limit 5
node bin\watomboard.mjs targets
node bin\watomboard.mjs doctor
```

## 在对话里当执行体

当用户在一个 Atom 上 `@codex` 时：

1. `atom show <id>` 读写作要求与交付目标；必要时 `note search` 从得到大脑补充上下文。
2. `atom move <id> in_progress` 表明动笔。
3. 在 Atom 目录里写 `draft.md`；素材写进 `素材/`，不要混入正文。
4. 每完成一个可汇报的节点就 `atom log` 一条，让看板上的人看见推进，而不是最后一次性汇报。
5. 结束时 `atom move <id> in_review`，并报告实际字数与文件路径。

不要替用户把状态推到 `done` —— 定稿是用户的动作。

## 得到大脑互操作

- `note search "<关键词>"` 语义检索；结果里的 `id` 可用于 `atom link`。
- `atom push <id>` 把该选题的写作要求、状态与最终稿件组装成一篇笔记存回得到大脑。
- `atom run <id> --note-query "<关键词>"` 把检索到的笔记片段注入 prompt。
- 项目知识库命名固定为 `WATOM-<项目名>`。

## 风格与主题

默认风格 `editorial`（编辑杂志风），默认主题 `white`。
风格层管形状/动效/强调色，主题层管底色/墨色；规范原文在 `styles/*.md`。

```powershell
watomboard style --style editorial
watomboard style --theme white             # white | cream | ink
```

界面约定：
- 卡片左缘与页面标题左缘对齐
- 「+」新建入口在 灵感 / 待写 / 写作中 三列的列头右上角
- 卡片横向拖动 = 改状态，并触发该转换的准备流程
- 时间线以事件为中心；最新在上，过程细节收进里程碑
- 卡片右上角实时显示执行状态（正构思 / 正写作 / 卡文 / 待审校 / 已定稿）

## 系统配置

| 项 | 说明 |
| --- | --- |
| Codex 路径 | 留空 = 自动定位桌面版内置的 `codex.exe`；也可显式指定 |
| 模型 | 留空 = 跟随 `~/.codex/config.toml` |
| 沙箱 | `approve-for-me`（默认，可写+自动审批）/ `workspace-write` / `read-only` / `danger-full-access` |
| 超时 | 执行体单次运行上限，默认 900 秒 |
| Codex 解析顺序 | 配置里的 `codex.bin` > 桌面版内置 > PATH |
| 端口 | Web 看板端口，默认 7789 |

配置存 `data/config.json`（本机）或 `~/.watomboard/config.json`（全局）。
`config --test` 会真跑一次最小 `codex exec`，返回版本、探针回复、会话 id 与得到大脑连通性。

## 注意事项

- 所有写操作都会产生 Event，并自动投影到 `logs/`。别手改 `data/watomboard.db`。
- 执行体内部再调用 `watomboard atom run` 会被递归保护拒绝（`ATOMBOARD_DEPTH`）。
- prompt 内已禁止执行 watomboard 命令与改动看板自身数据。
- 字数统计会剔除代码块、链接地址与 HTML 标签；素材目录整体不计。
- Web 深链：`?atom=AT-1` 直达详情、`?cfg=1` 打开系统配置、`?new=1` 新建表单、
  `?style=editorial` / `?theme=ink` 指定风格主题、`?still=1` 关动画（截图用）。
