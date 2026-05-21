<div align="center">

# ccgauge

**本地、隐私优先的 AI 编程 CLI 用量看板。** 把 **Claude Code** 与 **OpenAI Codex CLI** 的 token、花费、缓存节省统统聚合到同一个浏览器页面 —— 数据全程不离开你的电脑。

[![npm version](https://img.shields.io/npm/v/ccgauge?color=4F46E5&style=flat-square)](https://www.npmjs.com/package/ccgauge)
[![license](https://img.shields.io/npm/l/ccgauge?color=4F46E5&style=flat-square)](https://github.com/chengzuopeng/ccgauge/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/ccgauge?color=4F46E5&style=flat-square)](#)

[English](https://github.com/chengzuopeng/ccgauge/blob/main/README.md) · [简体中文](https://github.com/chengzuopeng/ccgauge/blob/main/README.zh-CN.md)

</div>

```bash
npx ccgauge
```

一行命令。ccgauge 自动读 Claude Code 和 Codex CLI 在本地写下的 JSONL 会话文件，按 天 / 项目 / 模型 / 会话 计算 token 用量与**美元等值花费**，在浏览器里打开统一看板，顶部一键切换数据源。**无登录、无遥测、无任何外网调用。**

![概览 — 中文 / Light](https://raw.githubusercontent.com/chengzuopeng/ccgauge/main/docs/screenshots/overview-zh-light.png)

---

## 为什么用 ccgauge

如果你按 token 计费用 API，或者在用 Claude Pro / Max / Team / Codex Plus 订阅，你大概关心过这些问题：

- *"Claude Code 这个月按 API 算下来要花多少钱？"*
- *"Prompt caching 到底帮我省了多少钱？"*
- *"哪个项目 / 会话 / 模型最吃 token？"*
- *"5 小时窗口还剩多久才重置？"*

终端工具 [ccusage](https://github.com/ryoppippi/ccusage) 给出的是一墙数字。ccgauge 给你**同样的数据加上图表、按维度下钻、5h 实时进度，并且是同时覆盖 Claude Code 与 OpenAI Codex CLI 的统一看板**。

整个看板是个本地 Next.js 应用，对话内容全程不出本机。

## 亮点

### 多 CLI 数据源
- 一份看板覆盖 **Claude Code** 与 **OpenAI Codex CLI**，并提供 **All 视图**把两者合并查看
- 顶部三档切换（Claude · Codex · All），每个按钮都带真品牌 logo；URL 用 `?source=` 持久化，cookie 记忆上次选择
- **Worktree 感知的 Projects 合并** —— 同一个 repo 的所有 worktree 自动并到同一个项目行
- 内置 **Provider 适配层**（`lib/providers/`）—— 增加第三个 CLI（Gemini CLI / Cursor / Aider …）只需一个新文件加注册表一行

### KPI 一眼看完
- 今日 token、今日花费、本月累计、缓存命中率、主力模型、今日活跃会话
- 每张卡都显示日环比 (`vs yesterday`)
- **5 小时 block 实时进度** —— 倒计时、进度条、每分钟 token 烧速、预计总花费

### 全维度下钻
- **会话页** —— 每场对话单独成行（模型 / token / 花费 / 时长），点进去看消息级时间线
- **项目页** —— 按 `cwd` 聚合成卡片网格，含趋势条与花费占比
- **模型页** —— 各模型并排对比：成本占比、token 占比、缓存命中、官方单价
- **用量页** —— 按对话轮次分组的明细表，可展开看每次工具调用，支持 CSV 导出。趋势图支持 **Token / 对话数** 切换，让条形图行数和用量表 1:1 对齐

### 成本透明
- **缓存节省** 单独成卡 —— 量化 Anthropic prompt caching 实际帮你节省了多少美元
- Codex 的成本标注为 **OpenAI API 单价折算估值**，方便订阅用户对比"按 API 计 vs 订阅价"
- 内置价格表：12 个 Claude 模型 + gpt-5 系列 + o 系列；未知模型自动回退到同 family 最新一档

### 精致的本地 UI
- **亮色 / 暗色 / 跟随系统** 三档主题，首屏无闪烁
- **English / 中文** 双语，cookie + localStorage 双向同步
- 完整筛选：时间区间（今天 / 7 天 / 30 天 / 90 天 / 全部）、粒度（小时 / 天 / 周 / 月）、模型 / 项目 multi-select

### 命令行报告（无 server）
- `ccgauge report` 读取同一份 JSONL，在 ~0.2 秒内打出彩色对齐的终端报告
- `--range / --source / --by / --since / --until / --model / --project` 滤波参数
- `--json` 输出给脚本；`--no-color` 走管道时自动开启 —— 可以直接塞进 shell 和 CI

### MCP 服务（给 LLM 用）
- `ccgauge mcp` 起一个 stdio JSON-RPC 服务，让 **Claude Desktop / Cursor / Cline** 等 MCP 客户端直接查你本地的 ccgauge 历史
- 9 个 MCP tool：`usage_summary`、`usage_by_time`、`usage_by_model`、`usage_by_project`、`usage_by_session`、`daily_summary`、`weekly_summary`、`recent_activity`、`cost_estimator`
- 支持模型有 reasoning token 时单独折算
- 独立命名缓存（`index-mcp-v2.json`），MCP 进程不会和仪表盘抢同一份磁盘索引

### 隐私优先
- 100 % 本地：只读访问已有 JSONL 文件，零外网调用
- 开源，MIT 协议
- 后台常驻模式，配套 `start / stop / restart / status / open / logs` 完整生命周期命令

## 快速开始

零安装一行运行：

```bash
npx ccgauge
```

或者全局安装：

```bash
npm  i -g ccgauge && ccgauge          # npm
pnpm i -g ccgauge && ccgauge          # pnpm
yarn global add ccgauge && ccgauge    # yarn
```

看板会在 [http://localhost:3737](http://localhost:3737) 打开。如果 3737 被占用，会自动顺延到下一个可用端口；按 `Ctrl+C` 停止。

**环境要求：** Node.js 20+（`pnpm test` 推荐 Node 22+）。已在 macOS / Linux / Windows 上验证。

## 命令行用法

`ccgauge` 是 `ccgauge start` 的简写，参数可以放在任一边。

### 前台模式（默认）

```bash
ccgauge
ccgauge --port 4000 --no-open
ccgauge start --host 0.0.0.0 --port 4000
```

### 后台服务模式

```bash
ccgauge start --background

ccgauge status
ccgauge open
ccgauge logs           # 最近 80 行
ccgauge logs --follow  # 实时跟随
ccgauge restart --port 4000
ccgauge stop
```

后台状态默认写在 `~/.ccgauge/`：
- `state.json` —— 进程 PID、URL、启动时间、日志路径
- `ccgauge.log` —— 服务输出（`ccgauge logs` 会读它）
- 设置 `CCGAUGE_STATE_DIR=/path/to/dir` 可隔离不同 profile（适合测试）

### 命令一览

| 命令 | 用途 |
| --- | --- |
| `ccgauge`, `ccgauge start` | 前台启动。`Ctrl+C` 停止。 |
| `ccgauge start --background` | 启动后台服务。 |
| `ccgauge stop [--force]` | 停止后台服务。 |
| `ccgauge restart [options]` | 停止再用新参数启动。 |
| `ccgauge status [--json]` | 查看后台状态。纯文本模式后台未运行时退出码 **3**（systemd 约定），shell 可用 `if ccgauge status; then …`；`--json` 始终退 0，请改读 `payload.running`。 |
| `ccgauge open` | 在浏览器打开正在运行的看板。 |
| `ccgauge logs [-f] [-n <lines>]` | 查看后台服务的日志（server stdout）。 |
| `ccgauge report [options]` | 命令行**用量报告**，直接打到终端（一次性，不起服务）。 |
| `ccgauge mcp` | 起 MCP 服务（stdio），让 LLM 查你的用量。 |
| `ccgauge doctor` | 一屏诊断：版本、env、构建产物、后台状态、indexer + 每个 provider 的扫描计数。报 issue 时直接粘。 |

### 命令行报告（report）

不需要起 server，直接读 JSONL，在终端打印漂亮的彩色对齐报告：

```bash
ccgauge report                       # 默认：近 7 天 / 所有数据源 / 前 10 个模型
ccgauge report -r 30d -b project     # 30 天，按项目分组
ccgauge report -s codex -m gpt-5.5   # 只看 codex 的 gpt-5.5*
ccgauge report --json                # 输出 JSON 给脚本用
ccgauge report --since 2026-05-01 --until 2026-05-08
```

report 参数：

| 参数 | 默认 | 作用 |
| --- | --- | --- |
| `-r, --range <range>` | `7d` | `today` / `1d` / `7d` / `30d` / `90d` / `all` |
| `-s, --source <provider>` | `all` | `claude` / `codex` / `all` |
| `-b, --by <dim>` | `model` | 分组维度：`model` / `project` / `session` |
| `-g, --gran <granularity>` | `day` | 趋势粒度：`hour` / `day` / `week` / `month` |
| `-n, --limit <n>` | `10` | 分组表显示行数 |
| `--since <date>` | — | 自定义起始日期（覆盖 `--range`，支持 `YYYY-MM-DD`） |
| `--until <date>` | — | 自定义截止日期 |
| `-m, --model <pat>` | — | 按模型名子串过滤 |
| `--project <pat>` | — | 按项目名 / cwd 子串过滤 |
| `-j, --json` | off | 输出 JSON 而不是格式化文本 |
| `--no-color` | — | 关掉 ANSI 颜色（管道里会自动关） |
| `--no-trend` | — | 不画趋势条 |
| `--no-breakdown` | — | 不打分组表 |

只写日期的 `--since/--until` 会按本地自然日边界处理，所以
`--until 2026-05-08` 会包含 5 月 8 日整天。

> 用 `report` 而不是 `logs` 是为了避免和 `ccgauge logs`（tail 后台 server 的 stdout）混淆。

### 启动参数

| 参数 | 适用命令 | 用途 |
| --- | --- | --- |
| `-p, --port <port>` | start, restart, 根命令 | 首选端口。默认 `3737`。 |
| `-H, --host <host>` | start, restart, 根命令 | 绑定地址。默认 `127.0.0.1`。 |
| `--no-open` | start, 根命令 | 前台不自动打开浏览器。后台模式本来就不自动打开，需要时用 `ccgauge open`。 |
| `--dir <path>` | start, restart, 根命令 | 把 `<path>/projects` 加入 Claude 数据源。 |
| `-q, --quiet` | start, restart, 根命令 | 静默 Next.js 输出。 |
| `-b, --background` | start, 根命令 | 以后台服务方式启动。 |
| `--strict-port` | start, restart, 根命令 | 端口不可用时直接失败。 |
| `--log <path>` | start --background, restart | 后台日志文件。 |

## MCP 服务（让大模型直接查你的用量）

ccgauge 内置了一个 [Model Context Protocol](https://modelcontextprotocol.io/) 服务，
任何 MCP 客户端（Claude Desktop / Cursor / Cline / Codex CLI / 自建 agent）都能
通过结构化 tool 调用，直接问大模型关于你本机 Claude Code + Codex CLI 历史的问题——
不用复制粘贴、不用截图看板。

### 你能问什么

配好之后，可以这样问：

- *"我这周在 AI 编程上花了多少？分别看下 Claude 和 Codex。"*
- *"我昨天都在做什么？"*
- *"列一下本月最贵的 10 个会话。"*
- *"过去 30 天哪个项目最吃 token？"*
- *"prompt caching 帮我省了多少钱？"*
- *"如果我在 Opus 4.7 上再跑 100K input + 20K output，要多少钱？"*
- *"上周 Codex 的 reasoning 开销有多大？"*
- *"给我一份本周完成事项的 standup bullet list。"*

LLM 会自动选合适的 tool、本地调用、用大白话给你带真实数字的答案。

### 工具一览

| Tool | 回答什么 |
| --- | --- |
| `usage_summary` | 一段时间内总 tokens / 花费 / 缓存节省。永远同时返回合并总数 + 按 source 拆分。 |
| `usage_by_time` | 时间序列（小时/天/周/月），用于趋势 / "什么时候开销爆了"。 |
| `usage_by_model` | 按模型的成本占比，每条带 source。 |
| `usage_by_project` | 按项目（cwd）的成本占比 + 会话数 + 最近活跃时间。 |
| `usage_by_session` | 会话列表，含标题（首条用户消息）/ 模型 / 时长 / 花费。可按 recent / cost / tokens / duration 排序。 |
| `daily_summary` | "今天 / 昨天 / 周一 / YYYY-MM-DD 我都干了啥？" 按项目分组的会话 + 模型 + top 工具调用。 |
| `weekly_summary` | 7 天 roll-up：每日花费趋势 + top 会话 + top 项目 + 模型分布。`week_offset=-1` 看上周。 |
| `recent_activity` | 最近 N 条活跃会话（默认最近 30 天，可显式给 `from`/`to`）。 |
| `cost_estimator` | 计算"假设我用 X 模型发 N 个 token 要花多少钱"。直接读内置 per-1M-token 单价表，不查历史。常用于额度规划 / what-if。 |

| Resource URI | 内容 |
| --- | --- |
| `ccgauge://providers` | 检测到的 provider、数据目录、文件 / 记录数、indexer 状态。 |

**公共参数**（每个分析类工具都接）：

- `source`：`"claude"` | `"codex"` | `"all"`（默认 `"all"`）。当 `"all"` 时，响应同时带合并总数 **和** `bySource: { claude, codex }` 拆分，让 LLM 一次调用就能回答 "总共多少" 和 "分别多少" 两类问题。
- 时间范围：传 `range`（`today` / `yesterday` / `this_week` / `last_week` / `this_month` / `last_month` / `7d` / `30d` / `90d` / `all`），**或**显式 `from` / `to`（ISO 日期或完整时间戳）。

### 在 MCP 客户端里配置

不同客户端的配置文件位置不同，但 snippet 形状一样。

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）/
`%APPDATA%\Claude\claude_desktop_config.json`（Windows）：

```json
{
  "mcpServers": {
    "ccgauge": {
      "command": "npx",
      "args": ["-y", "ccgauge", "mcp"]
    }
  }
}
```

如果已经全局装了 ccgauge（`npm i -g ccgauge`），可以省掉 `npx`：

```json
{
  "mcpServers": {
    "ccgauge": {
      "command": "ccgauge",
      "args": ["mcp"]
    }
  }
}
```

重启 Claude Desktop，工具选择器里就能看到 ccgauge 的 8 个工具。

#### Cursor

`~/.cursor/mcp.json`（项目级：`<project>/.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "ccgauge": {
      "command": "ccgauge",
      "args": ["mcp"]
    }
  }
}
```

#### Cline / Continue / 通用 MCP 客户端

任何遵循标准 `{ command, args, env? }` 格式的客户端都能用。`npx -y ccgauge mcp`
（无需全局装）或 `ccgauge mcp`（已全局装）任选其一。要覆盖扫描路径，通过 `env` 传：

```json
{
  "mcpServers": {
    "ccgauge": {
      "command": "ccgauge",
      "args": ["mcp"],
      "env": {
        "CCGAUGE_CODEX_DIR": "/custom/codex/path",
        "CLAUDE_CONFIG_DIR": "/custom/claude/path",
        "CCGAUGE_STATE_DIR": "/custom/cache/path"
      }
    }
  }
}
```

#### 验证是否生效

在 Claude Desktop 新开一个对话，问：

> *"你有哪些 ccgauge 工具？跑一下 usage_summary 看最近 7 天数据。"*

如果配置成功，Claude 会调 `usage_summary`，返回带 `totals` + `bySource` 的 JSON，
然后用大白话总结成带真实数字的回答。

### Prompt 示例集

直接复制丢进 Claude Desktop / Cursor / Cline 即可。每个 prompt 后面斜体注的是
LLM 大概率会调的工具——方便你"为什么会这样回答"反查。

#### 用量与花费

- *"我这周用 AI 编程花了多少钱？分开看 Claude 和 Codex。"*
  → `usage_summary({ range: "7d" })`
- *"本月 AI 编程花了多少？跟上个月比怎么样？"*
  → `usage_summary({ range: "this_month" })` + `usage_summary({ range: "last_month" })`
- *"画一下最近 30 天的每日花费趋势。"*
  → `usage_by_time({ range: "30d", granularity: "day" })`
- *"本月用的最多的 Claude 模型是哪个？花了多少？"*
  → `usage_by_model({ range: "this_month", source: "claude" })`
- *"本月最贵的 5 个会话是哪些？"*
  → `usage_by_session({ range: "this_month", sort: "cost", limit: 5 })`

#### 工作内容回顾 / standup

- *"我昨天都做了什么？按项目分一下。"*
  → `daily_summary({ date: "yesterday" })`
- *"给我一份周一 standup 用的 bullet list，列我上周完成的事。"*
  → `weekly_summary({ week_offset: -1 })`
- *"过去两周我接触最多的 3 个项目是什么？"*
  → `usage_by_project({ from: "2026-05-01", to: "2026-05-15", limit: 3 })`——非 `7d` / `30d` / `90d` / `this_week` / `last_week` 等命名窗口时，传显式 `from` / `to`。
- *"我最近一次的编码会话是关于什么的？"*
  → `recent_activity({ limit: 1 })`

#### 缓存 / 效率

- *"本月 Anthropic prompt caching 帮我省了多少 tokens？"*
  → `usage_summary({ range: "this_month", source: "claude" })`——返回里有 `saved_usd`。
- *"本周 Codex 的 output 里有多少比例是 reasoning tokens？"*
  → `usage_summary({ range: "7d", source: "codex" })`——返回里 `reasoning_tokens` 紧挨着 `output_tokens`。

#### 预算 / 规划

- *"按当前消耗速度，本月预计花多少？"*
  → `usage_summary({ range: "this_month" })` + `usage_by_time({ range: "this_month", granularity: "day" })`——LLM 自己外推。
- *"如果我今天再在 Opus 4.7 上跑 200K input + 50K output，本月累计要多少？"*
  → `cost_estimator({ source: "claude", model: "claude-opus-4-7", input_tokens: 200000, output_tokens: 50000 })` + `usage_summary({ range: "this_month" })`——estimator 直接按内置单价表返回这笔假设请求的美元成本，不查历史。

#### 跨数据源对比

- *"本月 Claude 和 Codex 哪个性价比更高（按每美元 tokens）？"*
  → `usage_summary({ range: "this_month" })`——两边数字都在 `bySource` 里。
- *"上周每个 provider 的最吃 token 项目分别是哪个？"*
  → `usage_by_project({ range: "last_week" })`（每条 entry 自带 `source`）。

### 隐私边界

- v1 **仅 stdio**——不开网络端口，不能远程访问
- 只读本机已有的 JSONL 文件，零上游 API 调用
- 错误信息里的绝对路径会脱敏（`$HOME` → `~`）
- MCP 用独立的持久化缓存文件（`~/.ccgauge/cache/index-mcp-v2.json`），永远不会和看板抢同一份磁盘状态

### 排障

| 现象 | 建议 |
| --- | --- |
| 客户端看不到 ccgauge 工具 | 改完配置重启客户端；不连 MCP 客户端就能验证 bundle / indexer / providers 的话直接跑 `ccgauge mcp --check`（或 `ccgauge doctor`）|
| 第一次调用比较慢 | 冷启动后第一次会全量索引（100 文件 ~1–3s）；之后都是 O(1) |
| Resource 显示 "no providers detected" | MCP 进程看不到 `~/.claude/projects` / `~/.codex/sessions`；通过 MCP 配置的 `env` 传 `CLAUDE_CONFIG_DIR` / `CCGAUGE_CODEX_DIR` |
| 想看 server 在打什么日志 | 看客户端的 MCP 日志；ccgauge 把日志写到 **stderr**（stdout 被 JSON-RPC 占用）|

## 配置

ccgauge 会自动识别标准路径：

| Provider | 默认数据源 |
| --- | --- |
| Claude Code | `~/.claude/projects`、`~/.config/claude/projects` |
| OpenAI Codex CLI | `~/.codex/sessions`、`~/.codex/archived_sessions` |

通过环境变量自定义：

| 变量 | 作用 |
| --- | --- |
| `CCGAUGE_CONFIG_DIR` | 把 `<dir>/projects` 也加入 Claude 数据源 |
| `CLAUDE_CONFIG_DIR` | 同上（兼容 Claude Code 1.0.30+） |
| `CCGAUGE_CODEX_DIR` | 额外的 Codex 会话目录 |
| `CODEX_HOME` | 把 `<dir>/sessions` 与 `<dir>/archived_sessions` 一并加入 |
| `CCGAUGE_STATE_DIR` | 覆盖后台服务的状态 / 日志目录 |

## 架构

```
~/.claude/projects/**/*.jsonl  ──┐
                                 ├─►  ProviderAdapter 注册表
~/.codex/sessions/**/*.jsonl  ───┘    │
                                      ▼
                              scanAll() ─► 去重 ─► 按 时间/模型/项目/会话/5h block 聚合
                                                ▼
                                  Next.js RSC 页面 + 客户端图表
```

1. **CLI**（`bin/cli.mjs`）归一化命令，校验 standalone 产物，用 [`get-port`](https://github.com/sindresorhus/get-port) 选端口。
2. **前台模式** 用 `fork()`，进程绑在终端上；**后台模式** 用 detached `spawn()`，状态写到 `~/.ccgauge/`。
3. **Provider 适配层**（`lib/providers/<name>/index.ts`）负责数据目录、JSONL 解析器、价格表、模型名格式化。注册表驱动 —— 加新 provider 就是一个新文件 + 注册表一行。
4. **Claude 解析器** 按行抽取 assistant 消息的 `usage`。
5. **Codex 解析器** 用一个轮状态机走事件流，对每个 `event_msg.token_count` 发射一条记录，**只用 `last_token_usage`**（避免累计字段重复计费）；`cached_input_tokens` 进 cache_read，`reasoning_output_tokens` 并入 output。
6. **价格** 走内置快照：Claude 用 Anthropic 官价（12 个模型），Codex 用 OpenAI 公开 API 单价（gpt-5 系列 + o 系列）。Codex 的成本标注为"API 单价折算估值"——订阅计划（Plus / Pro）实际计费方式不同。
7. **i18n + 主题**：cookie 驱动 SSR + `localStorage` 镜像 + `<head>` 注入同步执行的 no-flash 脚本。

## 增加新 Provider

```
lib/providers/<name>/
  index.ts             ProviderAdapter 实现
  parse-<name>.ts      JSONL → AssistantRecord[]
  pricing.ts           model → Pricing
  shorten-model.ts     模型名美化
```

然后在 `lib/providers/index.ts` 注册一行、在 `ProviderId` 联合里加一项。`scan.ts`、aggregator、价格、所有页面都不用动。

## 本地开发

仓库本身就是一个能跑的 Next.js 工程，可以一边改代码一边看实时数据。

```bash
git clone https://github.com/chengzuopeng/ccgauge.git
cd ccgauge
pnpm install
pnpm dev               # http://localhost:3738
```

常用脚本：

```bash
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint .
pnpm test              # codex parser 烟测（Node 22+）
pnpm build             # next build + 把 static 拷进 .next/standalone
pnpm start             # 用 bin/cli.mjs 跑 standalone 产物
pnpm screenshots       # 重新生成 docs/screenshots/*.png
pnpm site:dev          # 产品官网开发服务，http://localhost:4321
pnpm site:build        # 只构建 site/ 产品官网
pnpm clean             # rm -rf .next node_modules
```

发布：

```bash
pnpm pack              # 预览要发布的 tarball
pnpm publish --access public  # 会自动先跑 pnpm build（prepublishOnly）
```

## 排障

> **任何"为啥不工作"的问题先跑一下：** `ccgauge doctor`。一屏列出版本、env、构建产物、后台状态、indexer 扫描计数，报 issue 直接粘过去就行。

| 现象 | 建议命令 |
| --- | --- |
| 任何异常想先一屏看清 | `ccgauge doctor` — 下面所有项都在它的诊断里 |
| 端口被自动换掉 | `ccgauge --strict-port --port 3737` |
| 后台服务状态不对 | 先 `ccgauge status`，PID 仍存活但不响应再 `ccgauge stop --force` |
| 后台启动失败 | `ccgauge logs` 查看 `~/.ccgauge/ccgauge.log` |
| 想要干净的 profile | `CCGAUGE_STATE_DIR=/tmp/ccgauge-test ccgauge start -b` |
| Codex 没有数据 | 确认 `~/.codex/sessions` 存在；可在「设置」页查看检测到的路径 |
| 不想自动打开浏览器 | `ccgauge --no-open` |

## 常见问答

**ccgauge 会上传我的对话或日志吗？**
不会。ccgauge 全程跑在本地，只读 Claude Code 和 Codex CLI 已经写在本地的 JSONL 文件，没有任何外网调用。

**和 ccusage 有什么不同？**
[ccusage](https://github.com/ryoppippi/ccusage) 是终端工具，把用量打成表格。ccgauge 是 Web 看板，提供图表、按会话下钻、5 小时窗口实时进度、按项目 / 模型分维度统计，并且**开箱覆盖 OpenAI Codex CLI**。

**对 Claude Pro / Max / Team / Codex Plus 订阅用户有用吗？**
有用。看板始终展示**美元等值**的 API 折算成本，让你看到"如果按 API 计费这些用量值多少钱"。订阅计费方式不同，ccgauge 不替代你的账单。

**支持哪些模型？**
- **Claude Code**：所有 `claude-*` 模型（Opus / Sonnet / Haiku，3.x / 4.x）
- **OpenAI Codex CLI**：gpt-5 系列（gpt-5、gpt-5-mini、gpt-5-nano、gpt-5.4、gpt-5.5、gpt-5.5-mini、gpt-5.5-nano）、gpt-4.1 / gpt-4.1-mini，以及 o 系列（o3、o4-mini）
- 未知模型自动回退到同 family 最新一档单价

**能加我自己的 provider 吗？**
能 —— 见 [增加新 Provider](#增加新-provider) 一节。Provider 适配层就是为了显式留扩展点。

**需要 Anthropic / OpenAI 凭证吗？**
不需要。ccgauge 不调用任何上游 API，只读 CLI 已经写在本地的 JSONL 文件。

## 关键词

`claude code 看板` · `claude code 用量` · `claude code 花费` · `claude code 监控` ·
`codex cli 用量` · `codex cli 看板` · `openai codex 用量` · `openai codex 监控` ·
`AI 编程 CLI token 监控` · `claude pro 计划用量` · `claude max 计划用量` · `codex plus 用量` ·
`prompt caching 节省` · `5 小时窗口监控` · `rate limit 倒计时` · `ccusage 替代品` ·
`ccusage web 版` · `token 用量分析` · `本地 AI 用量监控` · `自部署 AI 看板`

## 产品官网

产品官网（Astro + Tailwind 自建、中英双语、暗 / 亮主题、独立部署）放在
[`site/`](./site/) 目录。它跟着主仓库一起在 git 里，但**不会**进 npm 包；
命令和依赖统一由根目录 `package.json` 管理。

```bash
pnpm site:dev   # http://localhost:4321
```

构建 / 部署细节见 [`site/README.md`](./site/README.md)。

## 许可证

MIT —— 详见 [LICENSE](https://github.com/chengzuopeng/ccgauge/blob/main/LICENSE)。
