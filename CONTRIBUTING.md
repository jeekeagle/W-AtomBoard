# 参与开发

## 本地运行

```bash
git clone https://github.com/jeekeagle/W-AtomBoard.git
cd W-AtomBoard
node bin/watomboard.mjs init
node bin/watomboard.mjs serve --port 7789
```

需要 Node.js 24 或更高版本（使用内置 `node:sqlite`）。项目运行时没有 npm 依赖，
前端 Markdown 渲染所需的两个库已 vendor 在 `web/vendor/`。

## 测试

```bash
npm test
```

提交前请确保全部测试通过。测试全部在临时目录运行，不会读写你的 `data/`。

## 代码结构

- `src/store.mjs`：SQLite 与数据访问
- `src/model.mjs`、`src/transitions.mjs`：状态机与流转规则
- `src/writing.mjs`：字数统计、稿件收集、全书稿拼接
- `src/runner.mjs`：Codex 执行与事件流解析
- `src/server.mjs`：HTTP API 与 SSE
- `web/`：看板与阅读页（原生 JS，无构建步骤）

## 提交约定

- 一个提交只做一件事；
- 提交信息用中文或英文均可，说明**为什么**改，而不只是改了什么；
- 不提交 `data/`、`workspaces/`、`logs/`、`book/` 下的任何内容。

## 报告问题

请附上：操作系统、Node 版本、复现步骤、相关日志（注意隐去本地路径与私人内容）。
