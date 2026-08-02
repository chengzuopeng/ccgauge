<div align="center">

# ccgauge

**Claude Code + Codex CLI 的 Token、花费、缓存节省看板。**
一行命令、零安装、全程不出本机。

[![npm](https://img.shields.io/npm/v/ccgauge?color=4F46E5&style=flat-square)](https://www.npmjs.com/package/ccgauge)
[![license](https://img.shields.io/npm/l/ccgauge?color=4F46E5&style=flat-square)](https://github.com/chengzuopeng/ccgauge/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/ccgauge?color=4F46E5&style=flat-square)](#)

**🌐 官网：[chengzuopeng.github.io/ccgauge](https://chengzuopeng.github.io/ccgauge)**

[English](https://github.com/chengzuopeng/ccgauge/blob/main/README.md) · [简体中文](https://github.com/chengzuopeng/ccgauge/blob/main/README.zh-CN.md)

</div>

```bash
npx ccgauge
```

ccgauge 读取 Claude Code 和 Codex CLI 本地已经写下的 JSONL 会话文件，按天 / 项目 / 模型 / 会话统计 token 用量与**美元等值花费**，在浏览器里打开统一看板，顶部一键切换数据源。也能让大模型通过内置的 MCP 服务直接查你的用量。不想开浏览器？`ccgauge report -d` 在终端里就有同款看板。

**无登录、无遥测，用量数据永不出本机** —— 唯一的外网请求是从 LiteLLM 拉取公开的模型价格，设 `CCGAUGE_OFFLINE=1` 连这个也关掉。

![概览 — 中文 / Light](https://raw.githubusercontent.com/chengzuopeng/ccgauge/main/docs/screenshots/overview-zh-light.png)

---

## 为什么选 ccgauge

- 🪟 **两个 CLI，一个看板。** Claude Code 与 OpenAI Codex CLI 并排展示 —— 顶部一键切换，或用 All 视图合并查看。同时覆盖两者的看板，目前就这一个。
- 💰 **缓存节省单独成卡。** 直接看本周 Anthropic prompt caching 帮你省了多少美元 —— 不是脚注，是 KPI 大卡。
- ⏱️ **5 小时窗口实时进度。** 倒计时、进度条、预计总花费 —— 在被限速前就知道窗口什么时候重置。
- 🤖 **MCP 原生支持。** 连上 Claude Desktop / Cursor / Cline，直接问*「我昨天都做了啥，按项目分一下？」* —— 真实数字、不截图、不复制粘贴。
- 🔒 **本地优先、隐私第一。** 只读你已有的 JSONL 文件，对话内容全程不出本机，MIT 开源。唯一的外网请求是从 LiteLLM 拉取公开的模型价格（设 `CCGAUGE_OFFLINE=1` 可关闭）。
- 🪜 **Worktree 感知。** 同一个 repo 的所有 worktree 自动合并到同一个项目行 —— 跟你的思维模型一致。

完整 release notes 见 [CHANGELOG.md](https://github.com/chengzuopeng/ccgauge/blob/main/CHANGELOG.md)。

## 功能一览

### 浏览器看板
- **概览** —— 6 张 KPI 卡（今日 token / 今日花费 / 缓存命中 / 主力模型 / 今日活跃会话 / 实时 5h block），每张都带日环比。
- **用量** —— 按对话轮次分组的明细表，可展开看每次工具调用，支持 CSV 导出；趋势图支持 **Token / 对话数** 切换。完整筛选：时间范围（含**自定义日期**）、粒度、模型 / 项目 multi-select。
- **会话** —— 每场对话的列表（模型 / token / 花费 / 时长），点进去看消息级时间线。
- **项目** —— 按 `cwd` 聚合的卡片，含趋势条与花费占比；worktree 自动合并到主仓库。
- **模型** —— 各模型并排：成本占比、token 占比、缓存命中、官方 per-1M 单价。
- **工具与技能** —— 按**预估上下文占用**给所有 tool / skill / MCP server 排名，用来揪出那个悄悄吃掉大半上下文的 skill。可按 skill / tool / MCP server 三个维度拆分。数字由 payload 体积估算（约 4 字符 1 token），不是 Anthropic 的按工具计费 —— 看排名，别当账单。仅支持 Claude 数据源，Codex 的 rollout 不记录所需结构。
- 会话 / 项目 / 模型 / 工具收在 **Analytics** 导航下拉里；概览、用量、设置保持顶层。
- **亮色 / 暗色 / 跟随系统** 三档主题，首屏无闪烁；**英 / 中** 双语，cookie + localStorage 双向同步。

### 命令行报告
- `ccgauge report` —— ~0.2 秒打出彩色对齐的终端报告，适合 CI。
- `ccgauge report -d` —— 富 TUI 看板：KPI tile、堆叠柱状趋势图、双列 breakdown 表、7×24 活跃热力图。
- 滤波：`--range / --source / --by / --since / --until / --model / --project`。
- `--json` 给脚本；`--no-color` 走管道时自动开启。

### MCP 服务
- `ccgauge mcp` —— stdio JSON-RPC 服务，接进 Claude Desktop / Cursor / Cline / 自建 agent。
- **9 个 tool**：usage summary、time-series、按模型 / 项目 / 会话拆分、daily / weekly summary、recent activity、假设请求成本估算。
- 模型有 reasoning token 时单独折算。
- 独立缓存（`index-mcp-v2.json`），MCP 进程和看板永远不抢同一份磁盘索引。

### 成本透明
- **缓存节省** 单独成卡，量化 Anthropic prompt caching 节省的美元。
- Codex 成本标注为 **OpenAI API 单价折算估值**，方便订阅用户对比 PAYG。
- 内置价格表覆盖 Claude 各家族直到 Claude 5，以及 gpt-5 / gpt-4.1 / o 系列全线，运行时从 LiteLLM 刷新；未知模型自动回退到同 family 最新单价。

### 隐私优先
- 本地优先：只读 JSONL 文件；唯一的外网请求是从 LiteLLM 拉取公开价格，设 `CCGAUGE_OFFLINE=1` 可关闭。
- 开源，MIT。
- 后台常驻模式，配套 `start / stop / restart / status / open / logs` 完整生命周期。

## 快速开始

```bash
npx ccgauge                              # 零安装一行运行
npm i -g ccgauge && ccgauge              # 或全局安装
```

看板默认开在 [http://localhost:3737](http://localhost:3737)。端口被占用会自动顺延到下一个可用端口，`Ctrl+C` 停止。

**环境要求：** Node.js 20+。macOS / Linux / Windows 均可。

## 命令行用法

### 命令一览

| 命令 | 用途 |
| --- | --- |
| `ccgauge`, `ccgauge start` | 前台启动看板服务。`Ctrl+C` 停止。 |
| `ccgauge start --background` | 启动后台服务。 |
| `ccgauge stop [--force]` | 停止后台服务。 |
| `ccgauge restart [options]` | 停止后用新参数重启。 |
| `ccgauge status [--json]` | 查看后台状态。纯文本模式后台未运行时退出码 **3**（systemd 约定）。 |
| `ccgauge open` | 在浏览器打开正在运行的看板。 |
| `ccgauge logs [-f] [-n N]` | 查看后台服务日志。 |
| `ccgauge report [options]` | 一次性命令行报告（文本 or TUI，不起服务）。 |
| `ccgauge mcp` | 起 MCP 服务让 LLM 查你的用量。 |
| `ccgauge doctor` | 一屏诊断 —— 报 issue 直接粘。 |

### 启动参数

| 参数 | 默认 | 用途 |
| --- | --- | --- |
| `-p, --port <port>` | `3737` | 首选端口。被占用自动顺延，除非加 `--strict-port`。 |
| `-H, --host <host>` | `127.0.0.1` | 绑定地址。 |
| `--no-open` | — | 前台模式不自动打开浏览器。 |
| `-b, --background` | — | 以后台服务方式启动。 |
| `-q, --quiet` | — | 静默 Next.js 输出。 |
| `--dir <path>` | — | 把 `<path>/projects` 加入 Claude 数据源。 |
| `--strict-port` | — | 端口不可用时直接失败。 |
| `--log <path>` | `~/.ccgauge/ccgauge.log` | 后台服务日志文件。 |

### 后台模式

```bash
ccgauge start -b                  # 后台服务，状态写在 ~/.ccgauge/
ccgauge status                    # PID / URL / 启动时间
ccgauge logs --follow             # 实时跟随日志
ccgauge stop                      # 优雅停止（或 --force）
```

`~/.ccgauge/` 下放 `state.json`（PID、URL、启动时间、日志路径）和 `ccgauge.log`。设置 `CCGAUGE_STATE_DIR=/tmp/profile` 可隔离 profile（适合测试）。

### `ccgauge report`

```bash
ccgauge report                       # 默认：近 7 天 / 所有数据源 / 文本
ccgauge report -d                    # 富 TUI 看板
ccgauge report -r 30d -b project     # 30 天，按项目分组
ccgauge report -s codex -m gpt-5     # 只看 Codex 的 gpt-5* 模型
ccgauge report --json                # 输出 JSON 给脚本
```

| 参数 | 默认 | 作用 |
| --- | --- | --- |
| `-r, --range <range>` | `7d` | `today` / `1d` / `7d` / `30d` / `90d` / `all` |
| `-s, --source <provider>` | `all` | `claude` / `codex` / `all` |
| `-b, --by <dim>` | `model` | 分组维度：`model` / `project` / `session` |
| `-g, --gran <gran>` | `day` | 趋势粒度：`hour` / `day` / `week` / `month` |
| `-n, --limit <n>` | `10` | breakdown 表显示行数 |
| `--since` / `--until` | — | 自定义日期范围（`YYYY-MM-DD`，按本地自然日） |
| `-m, --model <pat>` | — | 模型名子串过滤 |
| `--project <pat>` | — | 项目名 / cwd 子串过滤 |
| `-d, --dashboard` | — | 一屏富 TUI 布局（KPI tile + 堆叠趋势 + breakdown + 热力图） |
| `--width <n>` | 终端宽 | 强制输出宽度 —— 截图 / CI 时用 |
| `--no-banner / --compact` | — | dashboard 精简（不画 banner / 不画趋势图） |
| `-j, --json` | — | JSON 输出 |
| `--no-color` | 自动 | 关闭 ANSI 颜色（管道里自动关） |
| `--no-trend / --no-breakdown` | — | 跳过分块（仅文本模式） |

## MCP 服务 —— 让大模型直接查你的用量

配一次，之后就能用大白话问问题。各客户端（Claude Desktop / Cursor / Cline / Continue）的 snippet 形状一致：

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

重启客户端。可以试试：*「你有哪些 ccgauge 工具？跑一下 usage_summary 看最近 7 天。」*

已全局安装 ccgauge 的话可以省掉 `npx`，`"command": "ccgauge"` 即可。要覆盖扫描路径，通过 `env` 字段传 `CLAUDE_CONFIG_DIR` / `CCGAUGE_CODEX_DIR`。

### 工具一览

| Tool | 回答什么 |
| --- | --- |
| `usage_summary` | 一段时间内的总 tokens / 花费 / 缓存节省。永远同时返回合并总数 + 按 source 拆分。 |
| `usage_by_time` | 时间序列（小时 / 天 / 周 / 月）用于趋势问题。 |
| `usage_by_model` | 按模型的成本占比，每条带 source。 |
| `usage_by_project` | 按项目（`cwd`）的成本占比 + 会话数 + 最近活跃。 |
| `usage_by_session` | 会话列表，按 recent / cost / tokens / duration 排序。 |
| `daily_summary` | *「今天 / 昨天 / YYYY-MM-DD 我都干了啥？」* —— 按项目分组的会话 + top 工具调用。 |
| `weekly_summary` | 7 天 roll-up：每日花费趋势、top 会话 / 项目、模型分布。`week_offset=-1` 看上周。 |
| `recent_activity` | 最近 N 条活跃会话（跨 provider）。 |
| `cost_estimator` | 假设请求的美元成本。读内置价格表，不查历史。 |

每个分析类工具都接 `source`（`claude` / `codex` / `all`）和时间范围参数（`range`：`today` / `7d` / `30d` / `this_week` / `last_week` / `this_month` / `last_month` / `all`，或显式 `from` / `to`）。`all` 模式响应同时返回合并总数和 `bySource: { claude, codex }` 拆分 —— 一次调用回答两个层次的问题。

### Prompt 示例

- *「我这周用 AI 编程花了多少钱？分开看 Claude 和 Codex。」*
- *「画一下最近 30 天的每日花费趋势。」*
- *「本月最贵的 5 个会话是哪些？」*
- *「我昨天做了什么？按项目分一下。」*
- *「给我一份本周完成事项的 standup bullet list。」*
- *「按当前消耗速度本月预计花多少？如果今天再在 Opus 4.7 上跑 200K input + 50K output 要加多少？」*

### 隐私与排障

- v1 **仅 stdio** —— 不开网络端口。
- 只读本地 JSONL；错误信息里的绝对路径已脱敏（`$HOME` → `~`）。

| 现象 | 建议 |
| --- | --- |
| 客户端看不到工具 | 改完配置重启客户端；不连客户端验证可跑 `ccgauge mcp --check` 或 `ccgauge doctor` |
| 第一次调用慢 | 冷启动会全量索引（100 文件约 1–3s），之后 O(1) |
| Resource 显示 "no providers detected" | 通过 MCP `env` 传 `CLAUDE_CONFIG_DIR` / `CCGAUGE_CODEX_DIR` |
| 想看 server 日志 | 看客户端的 MCP 日志 —— ccgauge 写到 **stderr**（stdout 被 JSON-RPC 占用） |

## 配置

ccgauge 自动识别标准路径：

| Provider | 默认数据源 |
| --- | --- |
| Claude Code | `~/.claude/projects`、`~/.config/claude/projects` |
| OpenAI Codex CLI | `~/.codex/sessions`、`~/.codex/archived_sessions` |

通过环境变量自定义：

| 变量 | 作用 |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | 把 `<dir>/projects` 加入 Claude 数据源 |
| `CCGAUGE_CONFIG_DIR` | 同上（ccgauge 旧名字，兼容） |
| `CCGAUGE_CODEX_DIR` | 额外的 Codex 会话目录 |
| `CODEX_HOME` | 把 `<dir>/sessions` 与 `<dir>/archived_sessions` 一并加入 |
| `CCGAUGE_STATE_DIR` | 覆盖后台服务的状态 / 日志目录 |
| `CCGAUGE_OFFLINE=1` | 完全不向 LiteLLM 拉价格，只用仓库内置快照 |
| `CCGAUGE_PRICING_OFFLINE=1` | 同上，更明确的命名 |
| `CCGAUGE_PRICING_TTL_MS` | 价格缓存有效期（毫秒，默认 24 小时） |
| `CCGAUGE_POLL_FALLBACK` | `1` 强制开启索引器的轮询兜底，`0` 关闭（默认：除 MCP 外都开） |
| `CCGAUGE_MCP_PRETTY=1` | MCP 的 JSON 输出格式化，调客户端时好读 |
| `CCGAUGE_DEBUG` | 索引器详细诊断输出到 stderr |

## 本地开发

```bash
git clone https://github.com/chengzuopeng/ccgauge.git
cd ccgauge
pnpm install
pnpm dev               # http://localhost:3738
pnpm typecheck         # tsc --noEmit
pnpm test              # 解析器烟测（Node 22+）
pnpm build             # next build + 打包 MCP + 打包 CLI report
```

仓库本身就是一个能跑的 Next.js 工程，可以一边改代码一边对实时数据热重载。增加第三个 provider（Gemini CLI、Cursor、Aider…）只需在 [`lib/providers/<name>/`](https://github.com/chengzuopeng/ccgauge/tree/main/lib/providers) 下加一个新目录 + 在注册表加一行 —— `scan.ts` / aggregator / 价格模块 / 所有页面都不用动。

产品官网在 [`site/`](https://github.com/chengzuopeng/ccgauge/tree/main/site)（Astro + Tailwind），跟 npm 包独立发布 —— `pnpm site:dev` 启本地预览。

## 排障

> **任何"为啥不工作"的问题先跑一下：** **`ccgauge doctor`**。一屏列出版本、env、构建产物、后台状态、indexer 扫描计数，报 issue 直接粘。

| 现象 | 建议 |
| --- | --- |
| 端口被自动换 | `ccgauge --strict-port --port 3737` |
| 后台服务状态不对 | `ccgauge status`，必要时 `ccgauge stop --force` |
| 后台启动失败 | `ccgauge logs` 查 `~/.ccgauge/ccgauge.log` |
| Codex 没数据 | 确认 `~/.codex/sessions` 存在；在「设置」页查检测到的路径 |
| 不想自动打开浏览器 | `ccgauge --no-open` |

## 常见问答

**ccgauge 会上传对话或日志吗？**
不会。用量数据永不出本机：只读 Claude Code 和 Codex CLI 已经写下的本地 JSONL 文件，不需要任何 API 凭证。唯一出网的请求是**下载** —— 从 LiteLLM 拉公开模型价格，不携带任何你的信息。设 `CCGAUGE_OFFLINE=1` 可关闭，回退到仓库内置的价格快照。

**跟 [ccusage](https://github.com/ryoppippi/ccusage) 有什么不同？**
ccusage 是把用量打成表格的终端工具。ccgauge 是一个完整的 Web 看板：图表、按会话下钻、5h 实时进度、按项目 / 模型分维度统计，并且**开箱覆盖 OpenAI Codex CLI**。还多了一个 MCP 服务让 LLM 用自然语言查你的用量，以及一个终端版 TUI 看板（`ccgauge report -d`）—— 不想开浏览器时用。

**对 Claude Pro / Max / Team / Codex Plus 订阅用户有用吗？**
有用。看板始终展示**美元等值**的 API 折算成本，看到"如果按 API 计费这些用量值多少"。订阅计费方式不同，ccgauge 不替代你的账单。

**支持哪些模型？**
所有 `claude-*` 模型 —— Opus / Sonnet / Haiku / Fable，覆盖 3、4、5 三个代际 —— 以及 gpt-5 系列（含 gpt-5.6 各变体）、gpt-4.1 系列、o 系列（o3 / o4-mini）。未知模型自动回退到同 family 最新一档单价，所以比你这版 ccgauge 更新的模型也能算出合理价格。

## 许可证

MIT —— 见 [LICENSE](https://github.com/chengzuopeng/ccgauge/blob/main/LICENSE)。
