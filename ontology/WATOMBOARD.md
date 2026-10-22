# W-AtomBoard 信息本体

> 写作原子看板 —— 一个 Atom 是一个选题或一章，指派给 @codex / @skill / @agent 写，稿件落盘，字数回流，并与得到大脑笔记互通。

版本 0.3 · 生成于 2026-10-22 17:52:01（北京时间）

这份文件是 W-AtomBoard 的**本体**：它定义了这套系统里有什么、怎么流转、怎么被调用。
任何 Agent —— 人、Codex、技能、自定义 Agent —— 都应该先读它，再动手。

## 目的

- 把一本书拆成可独立动笔、可被指派、可被审校的选题与章节（Atom）
- 执行体（Codex / 技能 / 自定义 Agent）的每一次写作、产出、报错都留痕并回写看板
- 以「字数」为核心度量：目标字数写在 Atom 上，已写字数从真实稿件文件统计，不另建字数表
- 看板状态与得到大脑（GetNote）笔记双向互通：笔记可作为上下文注入，结论可回存为笔记

## 存储

- 引擎：SQLite（Node 24 内置 node:sqlite，零第三方依赖）
- 文件：`data/watomboard.db`（WAL）
- 表：`projects`、`atoms`、`events`、`links`、`runs`

## 实体

### Project

一本书 / 一个专栏，一个看板分组，同时也是本地的一个文件夹。

- 字段：
  - `key` : string —— 命令行可引用的短标识，ASCII，小写连字符
  - `name` : string —— 书名 / 专栏名，可用中文
  - `description` : string —— 一句话说明这本书写什么
  - `status` : enum `active | archived`
  - `folder` : string? —— 项目目录；默认 <根>/workspaces/<key>
- 关系：
  - 一个 Project 拥有多个 Atom
  - 一个 Project 对应一个本地文件夹，文件夹下每个 Atom 是一个子文件夹
  - 一个 Project 对应一个得到大脑知识库：WATOM-<项目名>

### Atom

选题或章节 —— 看板的最小写作单元。

- id 格式：AT-<序号，全局递增>
- 字段：
  - `project_id` : int → projects.id —— 所属项目，可随时改归属
  - `title` : string —— 选题 / 章节名
  - `body` : string —— 写作要求、素材线索、读者设定；@ 提及写在这里也会被解析
  - `target` : string —— 交付目标，例如「形成一篇 3000 字的读者指南」
  - `word_goal` : int —— 目标字数；0 表示未设
  - `status` : enum —— 见 stateMachine
  - `priority` : enum `low | normal | high | urgent`
  - `mentions` : json[] —— [{type,name,raw}]，决定谁来写
  - `progress` : int 0-100 —— 由执行体事件流与状态推导
  - `thread_id` : string? —— 执行产生的 codex 会话 id，便于追溯
  - `workspace` : string? —— 执行体的工作目录
  - `folder` : string? —— Atom 的本地目录；正文写 draft.md，素材放 素材/
- 关系：
  - 属于一个 Project
  - 拥有多条 Event
  - 可以关联多条 Link
  - 目录里的正文文件即它的字数来源

### Event

写作时间线条目 —— 以事件为中心，而不是以日志流水为中心。

- 字段：
  - `atom_id` : string → atoms.id
  - `ts` : ISO8601
  - `type` : string `created | status | note | output | thinking | command | file | plan | tool | error | link | getnote | thread | turn | usage | run_start | run_end | manual`
  - `actor` : string `user | board | codex | system | ui`
  - `message` : string
  - `data` : json
- 关系：
  - 只追加，永不修改 —— 这是所有 Agent 的共享事实来源

### Link

Atom 与外部对象的关联。

- 字段：
  - `kind` : enum `getnote | url`
  - `target` : string —— 得到大脑笔记 id 或 URL
  - `title` : string
- 关系：
  - getnote 类型的 target 即得到大脑 note_id

### Mention

执行体的指派标记，写在标题或描述里。

- 字段：
  - `type` : enum `codex | skill | agent`
  - `name` : string
  - `raw` : string —— 原文，如 @skill:baoyu-diagram
- 规则：
  - @codex —— 默认执行体
  - @skill:<名字> —— 定位 ~/.codex/skills、~/.agents/skills、项目 skills/ 下的 SKILL.md，注入为 $<名字> 触发
  - @agent:<名字> —— 定义在 agents.json（项目根或 ~/.watomboard/agents.json）
  - 裸 @名字 —— 先找技能，再找 Agent

## 状态机

| 状态 | key |
| --- | --- |
| 灵感 | `idea` |
| 待写 | `todo` |
| 写作中 | `in_progress` |
| 卡文 | `blocked` |
| 待审校 | `in_review` |
| 定稿 | `done` |

| 从 | 可到 |
| --- | --- |
| idea | `todo` |
| todo | `in_progress`, `blocked`, `idea` |
| in_progress | `blocked`, `in_review`, `done`, `todo` |
| blocked | `in_progress`, `todo` |
| in_review | `done`, `in_progress`, `blocked` |
| done | `in_progress`, `todo` |

- 执行体只能把 Atom 推进到 in_review（待审校）；done（定稿）必须由人确认
- 自动推进：todo → in_progress → in_review；失败则落到 blocked（卡文）
- 拖动到某状态会触发该转换的「准备流程」：追加一段提示词给 Codex，可选注入技能

## 写作度量

- 度量：字数 —— 中文按字计，英文/数字按词计；剔除代码块、链接地址与 HTML 标签
- 事实来源：Atom 目录里的真实 .md / .markdown / .txt 文件；不另建字数表
- 不计入字数的目录：`素材/`、`资料/`、`参考/`、`notes/`、`materials/`、`references/`
- 约定：
  - 正文写进 Atom 目录的 draft.md（可另建章节文件，同属正文）
  - 素材、访谈、参考放 素材/ 目录，不计入字数
  - 项目目录下 manuscript/ 存放拼好的全书稿
  - 项目级成果（封面、目录、样章）不属于任何 Atom，但属于项目
- 书稿：
  - 拼接：按 Atom 的 seq 顺序，把各 Atom 的正文拼成一份 Markdown 书稿
  - 导出：watomboard project export <key> [--status in_review,done] → <项目目录>/manuscript/全书稿-YYYY-MM-DD.md
  - 时区：Asia/Shanghai

## 执行

- 命令：`codex exec --json --skip-git-repo-check --approve-for-me [--sandbox <mode>] [-C <dir>] <prompt>`
- 事件流：JSONL：thread.started / turn.started / item.completed / turn.completed
- 进度：由 item.completed 中的 todo_list、command_execution、agent_message 等事件推进；最终由状态决定
- 安全阀：
  - **递归保护** —— 子进程带 ATOMBOARD_DEPTH 计数；执行体内部再调 watomboard atom run 会被拒绝
  - **执行边界** —— prompt 内明确禁止执行 watomboard 命令、禁止改动看板数据库与配置
  - **沙箱** —— 默认 --approve-for-me（可写 + 自动审批）；--sandbox read-only 可收紧
  - **验收权** —— 定稿（done）由人确认，执行体不得自行标记定稿

## 设计系统

- 结构：双层 token：风格层(data-style) 管形状/动效/强调色，主题层(data-theme) 管底色/面色/墨色
- 默认风格：`editorial`，默认主题：`white`

| 风格 | 名称 | 规范文件 | 特征 |
| --- | --- | --- | --- |
| `editorial` | 编辑杂志风 | `styles/editorial.md` | 纯单色、衬线标题、发丝线分隔、无阴影无圆角、hover 斜体、下划线动画 |

主题：`white` / `cream` / `ink`

- 卡片左缘必须与页面标题左缘对齐（同一 shell 内边距）
- 「+」新建入口放在 灵感 / 待写 / 写作中 三列的列头右上角
- 可交互元素必须有 hover / active / focus-visible 三态
- 时间线以事件为中心：milestone 占一行，过程细节收进所属里程碑

## Codex

- 默认：codex-cli 0.163.0（npm 安装的正式版）
- 解析顺序：显式配置 data/config.json 的 codex.bin > 桌面版内置 > PATH
- 其他可用：
  - desktop —— 桌面版内置 codex.exe（0.163.0-alpha.11），命令别名 codex-desktop
  - app-server —— ~/.codex/packages/app-server-daemon 内的 0.163.0
- 命令：`codex` → 默认正式版，`codex-desktop` → 桌面版内置 alpha

## 集成：得到大脑

- 客户端：getnote（@getnote/cli，本机已登录）
- 知识库：每个项目一个知识库，命名 WATOM-<项目名>；项目里的 Atom 启动的 Codex 都可以读它
- 读：watomboard note search "<关键词>" [--limit N] [--kb ID] —— 语义检索
- 写：watomboard atom push <AT-id> —— 把写作要求 + 最终稿件存成一篇笔记
- 关联：watomboard atom link <AT-id> --note <note_id>
- 注入上下文：watomboard atom run <AT-id> --note-query "<关键词>" —— 检索到的笔记片段注入 prompt 的「相关笔记」段

## 接口

### CLI

入口：`node bin/watomboard.mjs <命令>`（全局命令 `watomboard（等价命令，装在 ~/.local/bin）`）

| 命令 | 作用 |
| --- | --- |
| `project add/list` | 项目管理（一本书） |
| `project export <key>` | 导出全书稿 |
| `atom new/list/show` | 建选题、看列表、看详情与时间线 |
| `atom words <id> [n]` | 查看字数 / 设置目标字数 |
| `atom stats <项目>` | 项目写作统计 |
| `atom move <id> <status>` | 改状态并留痕 |
| `atom log <id> <消息>` | 记一条写作进展 |
| `atom run <id> [--background] [--workspace 目录] [--note-query 关键词] [--dry-run]` | 动笔；dry-run 只打印将要发出的 prompt |
| `atom link <id> --note <id>` | 关联得到大脑笔记 |
| `atom push <id>` | 把稿件推送到得到大脑 |
| `atom delete <id>` | 删除 |
| `targets` | 列出所有可用的 @ 执行目标 |
| `board` | 终端文本看板 |
| `serve [--port 7789]` | 本地看板 Web UI（SSE 实时推送） |
| `note search/show/save` | 直接操作得到大脑 |
| `ontology [--print]` | 读取/重新生成信息本体 |
| `log [--tail N]` | 读取全局 Log |
| `state` | 打印当前看板状态快照 |
| `style [--theme white|cream|ink]` | 风格与主题 |
| `doctor` | 自检 |

### HTTP

基址：`http://127.0.0.1:7789`

- `GET /api/state` —— 看板全量状态
- `GET /api/style` —— 风格与主题注册表
- `GET /api/targets` —— 可用 @ 执行目标
- `GET /api/stream` —— SSE 实时状态推送
- `GET /api/writing` —— 全部项目的字数汇总
- `GET /api/projects/:id/writing` —— 单项目字数统计
- `GET /api/projects/:id/manuscript?statuses=a,b` —— 拼好的全书稿
- `POST /api/projects/:id/manuscript/export` —— 导出全书稿到项目目录
- `GET /api/atoms/:id` —— 单个选题 + 事件 + 关联 + 字数
- `GET /api/atoms/:id/writing` —— 单个选题的字数与正文文件
- `POST /api/atoms/:id/word-goal` —— 设目标字数 {word_goal}
- `POST /api/atoms` —— 新建选题 {title, body, target, project_id, priority, status, mentions[], word_goal}
- `POST /api/atoms/:id/target` —— 改交付目标 {target}
- `POST /api/atoms/:id/project` —— 改所属项目 {project_id}
- `POST /api/atoms/:id/move` —— 改状态 {status}
- `POST /api/atoms/:id/log` —— 记日志 {message}
- `POST /api/atoms/:id/run` —— 就地执行
- `POST /api/projects` —— 新建项目 {name, description}

### 磁盘契约

- `ontology/watomboard.json` —— 信息本体（机读）
- `ontology/WATOMBOARD.md` —— 信息本体（人读）
- `logs/events.jsonl` —— 全局事件流，追加写入，永不改写
- `logs/LOG.md` —— 全局 Log 的可读渲染
- `logs/STATE.md` —— 当前状态快照
- `agents.json` —— 自定义 Agent 定义
- `skills/w-atomboard/SKILL.md` —— 给 Codex 的技能包（已装到 ~/.codex/skills/）
- `workspaces/<项目>/<Atom>/draft.md` —— Atom 的正文
- `workspaces/<项目>/<Atom>/素材/` —— Atom 的素材，不计字数
- `workspaces/<项目>/manuscript/` —— 全书稿

## 约定

- 所有写操作都必须留痕：任何状态变化、稿件产出、关联都要产生一条 Event
- Agent 读取看板的标准入口：先读 ontology/WATOMBOARD.md，再读 logs/STATE.md，需要历史就读 logs/LOG.md
- 不要手改 data/watomboard.db；所有变更走 CLI 或 HTTP 接口
- 执行体不得自行把 Atom 标记为定稿（done）
- 正文只写 Atom 目录下的 .md/.markdown/.txt；素材放 素材/，避免被计入字数
- 时间线以事件为中心：新增一个里程碑事件，并带上产出文件路径
