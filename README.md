# QQ AI 机器人

通过 NapCat 的 OneBot 11 WebSocket 控制一个普通 QQ 小号，并把白名单好友的
私聊消息或白名单群内的 `@机器人` 消息交给本机 Codex。文字聊天、实时搜索、
图片识别以及图片生成/编辑全部走 Codex CLI，不再调用 PackyAPI。

> NapCat/OneBot 不是 QQ 开放平台官方群机器人通道，存在登录验证、掉线、
> 账号限制或封号风险。只使用专门的小号，不要使用主 QQ，也不要在同一设备上
> 高频操作多个账号。

## 维护与交接

后续新 AI 会话或人工维护时，先阅读：

- [`AGENTS.md`](AGENTS.md)：当前完成状态、协作约束和代码导航
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)：启动、重启、加群、改人设、验证和排障流程
- [`docs/PERSONA.md`](docs/PERSONA.md)：铃铃酱当前人设的非敏感副本

真实 QQ 号、群号和 Token 只保存在本机 `.env.local` 或 NapCat 配置中，不写入
上述文档。Codex 使用本机已有的 ChatGPT 登录，不需要在项目里保存 AI API Key。

## 当前能力

- 主动连接 NapCat 正向 WebSocket，无需公网 IP 或回调地址
- 私聊只响应配置的好友 QQ 号；群聊只响应白名单群内的 `@机器人`
- 使用受限的本机 Codex CLI，默认模型为 `gpt-5.6-sol`
- 支持实时网页搜索；需要最新信息时由 Codex 主动搜索并在回复中给出来源链接
- 支持图片识别：纯图片、文字加图片以及一次多图
- 支持按群友要求生成图片，以及结合附加图片进行编辑；生成结果会作为真正的 QQ 图片发送
- 每个私聊好友或“群 + 成员”独立保留最近对话，避免串上下文
- `/重置` 清除自己的当前对话，`/帮助` 查看用法
- 消息去重、成员/群/全局限流、同一成员串行排队、长回复自动分段
- 群聊回复原消息并 @提问者；私聊直接回复
- 支持通过 `AI_SYSTEM_PROMPT` 自定义名字、人设、语气和回复规则
- 群聊内容不能启用 Codex 的 Shell、文件修改、应用、插件或电脑控制工具
- OneBot Token 和好友/群白名单只从本地环境变量读取

## 数据流

```text
主账号私聊专用QQ小号 / 群成员 @专用QQ小号
        ↓
      NapCat
        ↓ OneBot 11 WebSocket
    本项目 Node.js 程序
        ↓ 受限的非交互 Codex CLI
  聊天 / 网页搜索 / 识图 / 生图
```

## 环境要求

- macOS、Windows 或 Linux
- Node.js 22 或更高版本
- pnpm 11
- 一个专门用于机器人的 QQ 小号
- NapCat（macOS 可使用当前 Release 中的 DMG）
- 已安装并登录的 Codex CLI（运行 `codex login status` 应显示已登录）

NapCat 下载与文档：

- [NapCat Releases](https://github.com/NapNeko/NapCatQQ/releases)
- [NapCat WebUI 配置](https://napneko.github.io/config/basic)
- [OneBot 11 事件格式](https://napneko.github.io/onebot/basic_event)

Codex 运行与安全参考：

- [Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex 沙箱与审批](https://learn.chatgpt.com/docs/agent-approvals-security)

## 1. 配置 NapCat

1. 安装并启动 NapCat，使用手机 QQ 扫码登录专用小号。
2. 打开启动日志给出的 WebUI 地址；默认端口通常为 `6099`。
3. 在“网络配置”中新建 **WebSocket 服务器（正向 WS）**。
4. 使用以下设置：

```text
名称：qq-group-ai-bot
启用：是
主机：127.0.0.1
端口：3001
消息格式：array
上报自身消息：否
Token：生成一个随机且足够长的 Token
```

WebSocket 只监听 `127.0.0.1`，不要把未加密的 OneBot 端口暴露到公网。

### macOS 同时运行主号和 NapCat 小号

项目提供了独立启动脚本。磁盘上的 QQ 默认始终保留原版入口，所以平时从
Dock 或“应用程序”打开 QQ，正常登录和使用主号即可。需要启动机器人小号时，
在项目目录运行：

```bash
pnpm qq:start-napcat:macos
```

脚本会自动识别已经生成 OneBot 配置的小号，短暂切换当前 QQ 热更新入口，
加载 NapCat 后立即恢复原版入口；启动失败时也会在 5 秒内兜底恢复。因此普通
QQ 可以和 NapCat 小号同时运行。若本机存在多个 NapCat 账号配置，可仅在本地
指定小号：

```bash
NAPCAT_QQ_ACCOUNT=小号QQ号 pnpm qq:start-napcat:macos
```

检查 QQ 是否处于可安全双启动的状态：

```bash
pnpm qq:verify-macos
```

QQ 自动更新后，启动脚本会读取当前版本再执行瞬时注入，不需要手工修改新版本
的 `package.json`。

## 2. 配置项目

首次使用时复制模板：

```bash
cp .env.example .env.local
chmod 600 .env.local
```

填写 `.env.local`：

```dotenv
ONEBOT_WS_URL=ws://127.0.0.1:3001
ONEBOT_ACCESS_TOKEN=与NapCat中完全一致的Token
ONEBOT_ALLOWED_PRIVATE_USER_IDS=你的主账号QQ号
ONEBOT_ALLOWED_GROUP_IDS=

CODEX_COMMAND=codex
CODEX_MODEL=gpt-5.6-sol
CODEX_REASONING_EFFORT=medium
CODEX_LIVE_SEARCH=true
CODEX_TIMEOUT_MS=300000
CODEX_MAX_CONCURRENT=2
CODEX_MAX_QUEUE=12
```

私聊测试通过后，把目标群号加入群白名单；多个号码使用英文逗号分隔：

```dotenv
ONEBOT_ALLOWED_PRIVATE_USER_IDS=123456789
ONEBOT_ALLOWED_GROUP_IDS=123456789,987654321
```

两个白名单至少填写一个。私聊不需要 `@`；群聊只有 `@机器人` 才会触发。

程序会把 QQ 图片验证后写入单次临时工作区，再通过 Codex 的 `--image` 输入。
支持 JPG、PNG、WebP 和 GIF，单张最多 8 MB、一次最多 4 张。Codex 生成的图片
会从该次任务的独立生成目录读取为内存数据，发送成功后不会加入会话记忆。

首次启动前检查：

```bash
codex --version
codex login status
```

不要把 `.env.local` 或 OneBot Token 提交到 Git，也不要粘贴到聊天中。

## 3. 安装与运行

先启动 NapCat，再运行本项目：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

开发时可用：

```bash
pnpm dev
```

日常管理机器人：

```bash
pnpm status   # 查看 Node 机器人是否运行
pnpm stop     # 安全关闭 AI 回复，NapCat 小号保持在线
pnpm restart  # 安全重启并继续在当前终端运行
```

这些命令只匹配本项目工作目录中的 `node dist/index.js`，不会关闭普通 QQ、
NapCat 小号或其他项目的 Node 服务。`pnpm start` 和 `pnpm restart` 一样需要保持
当前终端运行；按 `Control + C` 也可以停止。

日志出现 `已连接 NapCat WebSocket` 和 `机器人已就绪` 后，先用白名单中的
主账号私聊专用小号：

```text
你好，只回复“私聊测试成功”
```

后续启用群聊后，在白名单群中发送：

```text
@机器人 你好，请介绍一下你自己
```

也可以在私聊中直接发送图片，或在群里发送 `@机器人 + 图片`。没有附带文字时，
机器人会默认按“请描述这张图片”处理；需要 OCR、排错或比较多张图时，建议同时
写清具体要求。

生成图片示例：

```text
画一张铃铃酱在森林里追蝴蝶的动漫头像，绿色主色调
```

编辑图片时把原图和要求放在同一条消息，例如“把背景改成夜晚，人物保持不变”。
图片生成通常比文字回复慢，默认超时为 5 分钟，也会消耗 Codex/ChatGPT 账号额度。

## 常见问题

### 连接被拒绝或出现 401/403

检查 `ONEBOT_ACCESS_TOKEN` 是否和 NapCat WebSocket 服务器中的 Token 完全一致。

### ECONNREFUSED 127.0.0.1:3001

NapCat 未启动、正向 WebSocket 未启用，或端口不是 `3001`。

### 群里 @机器人但没有回复

检查：

- 专用 QQ 小号是否仍在线并已加入目标群
- 群号是否已写入 `ONEBOT_ALLOWED_GROUP_IDS`
- NapCat 消息上报格式是否为 `array`
- 项目日志是否收到 OneBot 事件或 Codex 错误

### 好友私聊但没有回复

检查主账号 QQ 号是否已写入 `ONEBOT_ALLOWED_PRIVATE_USER_IDS`，并确认消息发给的
确实是运行 NapCat 的专用小号。机器人不会响应未列入白名单的好友。

### 图片没有被识别

确认发送的是 JPG、PNG、WebP 或 GIF，且单张不超过 8 MB；再用
`codex login status` 检查本机 Codex 登录。

### Codex 无法回复或无法生成图片

先检查 `codex login status`、ChatGPT/Codex 额度和网络。图片生成可能需要一至数
分钟；若经常超时，可在允许范围内增大 `CODEX_TIMEOUT_MS`。升级 Codex 后先运行
一次受限的文字和图片生成测试，再重启机器人。

## 数据与安全边界

- AI 对话上下文仅保存在进程内存中，重启后自动清空。
- 会话按“私聊好友”或“群 + 成员”隔离，默认最多保留 8 轮，闲置 24 小时自动清理。
- 图片只在当前请求中处理，不把二进制写入会话记忆；后续对话仅保留文字问题和
  AI 回答。重启后所有内存会话仍会清空。
- 群消息和图片会交给本机 Codex 及其后端服务，不要让机器人处理密码、身份信息等
  敏感内容。
- 每次调用使用只读临时目录并关闭 Shell、应用、插件、电脑控制和文件修改能力；
  只保留网页搜索、理解附加图片和图片生成/编辑能力。
- OneBot WebSocket 默认仅允许本机访问，并必须配置 Token。

## 项目结构

```text
src/
├── ai/                         # 受限 Codex CLI 适配器与 AI 窄接口
├── onebot/                     # OneBot WebSocket、事件解析和私聊/群回复
├── config.ts                   # 环境变量校验与好友/群白名单
├── conversation-memory.ts      # 有界、隔离的对话记忆
├── group-chat-handler.ts       # 私聊/群聊命令与 AI 对话编排
├── runtime-guards.ts           # 去重、限流和按成员排队
├── create-bot.ts               # NapCat/OneBot 运行时装配
└── index.ts                    # 启动与优雅退出

legacy/qq-open-platform/        # 先前 QQ 开放平台接入源码备份
docs/OPERATIONS.md              # 当前部署、运维、加群、验证和排障
docs/PERSONA.md                 # 铃铃酱人设的非敏感持久副本
AGENTS.md                       # 新 AI 会话首先读取的项目约束与状态
```
