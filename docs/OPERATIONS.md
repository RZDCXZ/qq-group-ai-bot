# QQ AI 机器人运维与交接

本文记录当前部署结果和可重复执行的维护流程。所有真实 QQ 号、群号和密钥只保存在 `.env.local` 或 NapCat 本地配置中，不在文档中出现。

## 1. 当前部署快照

最后更新：2026-07-19。

| 项目 | 当前状态 |
| --- | --- |
| QQ 接入 | 普通专用小号 + NapCat + OneBot 11 正向 WebSocket |
| 主号与小号 | macOS 上可同时运行；主号使用正常 QQ 界面，小号由 NapCat 后台运行 |
| AI 服务 | 本机 Codex CLI，使用本机已有的 ChatGPT 登录 |
| 模型与模式 | `gpt-5.6-sol` + medium reasoning + 非交互临时任务 |
| 私聊 | 1 个白名单好友，可直接发送文字或图片 |
| 群聊 | “杀鸡练习生测试”已加入群白名单，必须 `@铃铃酱` 才触发 |
| 人设 | 森林系猫娘“铃铃酱”，完整内容见 `docs/PERSONA.md` |
| 图片输入 | JPG、PNG、WebP、GIF；单张最多 8 MB，一次最多 4 张 |
| 图片输出 | 支持 Codex 生成/编辑图片，单次最多回传 1 张，按 OneBot 图片消息发送 |
| 会话 | 每位好友或“群 + 成员”独立，默认保留最近 8 轮，闲置 24 小时过期 |
| 最近历史验收 | 私聊文字、私聊图片、双 QQ、入群、自我介绍和群白名单均通过；Codex 迁移后需按第 9 节复验 |
| 当前代码验收 | 类型检查、构建、12 个测试文件 61 项测试、真实 Codex 文字/生图/取图，以及 `pnpm status`、`pnpm stop`、`pnpm restart` 实机验证均通过 |

自我介绍已经由铃铃酱账号发送并在主号 QQ 界面确认：

> 哥哥们好呀，我是铃铃酱，是刚来群里的森林系 AI 猫娘 ฅ^•ﻌ•^ฅ 平时可以陪哥哥们聊天、接梗、看图，也能帮忙回答各种问题。想找我时 @铃铃酱 就好，请多关照喵~

## 2. 实际架构

```text
主号私聊 / 白名单群成员 @铃铃酱
                ↓
        专用 QQ 小号（NapCat）
                ↓ OneBot 11 WS，127.0.0.1:3001
          本项目 Node.js 进程
                ↓ 受限 codex exec
  gpt-5.6-sol / 搜索 / 识图 / 生成与编辑图片
                ↓
     OneBot 回复私聊或原群消息
```

当前方案不是 QQ 开放平台官方群机器人。早期开放平台代码保留在 `legacy/qq-open-platform/`，只用于参考。

## 3. 配置边界

实际配置文件是 `.env.local`，已被 `.gitignore` 忽略，必须保持 `chmod 600`。新会话需要确认配置时，只读取必要字段并输出脱敏摘要，不要打印整个文件。

主要字段：

```dotenv
ONEBOT_WS_URL=ws://127.0.0.1:3001
ONEBOT_ACCESS_TOKEN=本机私密值
ONEBOT_ALLOWED_PRIVATE_USER_IDS=逗号分隔的好友QQ号
ONEBOT_ALLOWED_GROUP_IDS=逗号分隔的群号

CODEX_COMMAND=codex
CODEX_MODEL=gpt-5.6-sol
CODEX_REASONING_EFFORT=medium
CODEX_LIVE_SEARCH=true
CODEX_TIMEOUT_MS=300000
CODEX_MAX_CONCURRENT=2
CODEX_MAX_QUEUE=12
AI_SYSTEM_PROMPT="多行铃铃酱人设"
CONVERSATION_MAX_TURNS=8
CONVERSATION_TTL_MS=86400000
```

安全约束：

- 群白名单与私聊白名单至少配置一项。
- 机器人不会响应非白名单私聊，也不会响应白名单群中未 `@` 机器人的普通消息。
- 机器人子进程采用只读临时工作区、`approval=never`、临时会话；关闭 Shell、文件修改、应用、插件、电脑控制、多代理等能力，只保留网页搜索、识图和图片生成/编辑。
- 群消息和图片会交给 Codex 及其后端服务，不应让机器人处理密码、证件或其他敏感信息。
- `.env.local` 不再需要 PackyAPI 地址、密钥、模型或接口模式；旧字段即使暂时保留也不会被当前入口读取，清理前仍按敏感值处理。

## 4. 日常启动顺序

项目目录：`/Users/why/code/my-project/qq-group-ai-bot`。

### 4.1 正常主号 QQ

从 Dock 或“应用程序”正常打开 QQ。磁盘上的 QQ 入口应始终保持原版，主号界面不依赖 NapCat。

### 4.2 NapCat 小号

先检查是否已经存在 NapCat 小号进程；没有时在项目目录运行：

```bash
pnpm qq:start-napcat:macos
```

脚本会从 NapCat 的 `onebot11_*.json` 配置自动识别唯一小号。若以后存在多个小号配置，需要仅在本机指定：

```bash
NAPCAT_QQ_ACCOUNT=小号QQ号 pnpm qq:start-napcat:macos
```

小号由 NapCat 在后台运行，看不到完整 QQ 窗口是正常现象；正常 QQ 主号仍可使用完整界面。

验证双启动保护：

```bash
pnpm qq:verify-macos
```

该检查会确认基础入口和当前热更新入口都已恢复为 QQ 原版，并检查瞬时注入加载器的恢复逻辑。不要手工编辑 QQ 的 `package.json`。

### 4.3 Node 机器人

首次安装或代码有改动时：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

启动前确认本机 Codex 可用：

```bash
codex --version
codex login status
```

启动：

```bash
pnpm start
```

成功日志应同时包含：

```text
[onebot] 已连接 NapCat WebSocket
[app] QQ AI 机器人已就绪
```

并确认日志中的 `allowedGroupCount`、`allowedPrivateUserCount` 与预期一致。不要启动两个 Node 机器人实例，否则同一条消息可能被重复处理。

## 5. 安全重启

只修改 `.env.local` 不需要重新构建，但必须重启 Node 机器人；修改 `src/` 后必须先 `pnpm build`。

日常直接使用项目命令：

```bash
pnpm status
pnpm stop
pnpm restart
```

`pnpm stop` 只关闭本项目的 Node AI 机器人，NapCat 小号继续在线；`pnpm restart`
会先安全关闭旧实例，再像 `pnpm start` 一样在当前终端运行新实例。管理脚本同时
核对进程命令与工作目录，不依赖模糊的 `pkill node`。

只有管理命令自身失效时，才手工使用 `ps`、`lsof` 核对 PID、命令和工作目录，
再对已确认的机器人 PID 执行 `kill -TERM PID`。

不要停止以下对象：

- `/Applications/QQ.app/...` 的正常主号 QQ。
- `scripts/macos/launch-napcat.mjs` 对应的 NapCat 小号启动器。
- 其他项目中同样名为 `dist/index.js` 的 Node 服务。

重启会清空内存会话，群成员需要重新开始上下文；白名单和人设不会丢失。当前默认每位成员保留最近 8 轮，最后一次访问后 24 小时未互动才过期。

## 6. 添加新群

只有用户明确指定目标群并授权后才执行。

1. 在正常主号 QQ 中打开目标群，点击“邀请加群”，选择机器人小号。
2. 正式点击“确定”前再次核对目标群和小号，因为入群会让小号持续接收该群消息。
3. 入群后通过 NapCat 的 OneBot `get_group_list` 查询真实 `group_id`，不要根据群名猜测。
4. 将群号追加到 `.env.local` 的 `ONEBOT_ALLOWED_GROUP_IDS`，多个群号使用英文逗号分隔。
5. 用 `loadConfig()` 输出布尔值或数量进行脱敏校验，不打印白名单原值和密钥。
6. 按“安全重启”步骤重启机器人，日志中群白名单数量应增加。
7. 在群内使用 `@铃铃酱 你好` 验证；未 `@` 的群消息不会触发。

主动发送入群自我介绍时，使用 OneBot `send_group_msg`，消息格式使用数组：

```js
await client.call("send_group_msg", {
  group_id: targetGroupId,
  message: [{ type: "text", data: { text: introduction } }],
});
```

发送消息属于外部操作，必须有用户对具体群和消息目的的明确授权。发送后用主号 QQ 界面或 OneBot 返回的 `message_id` 核验。

## 7. 修改人设或回复规则

当前人设副本见 `docs/PERSONA.md`，实际运行值是 `.env.local` 中的多行 `AI_SYSTEM_PROMPT`。

1. 只替换 `AI_SYSTEM_PROMPT`，不要改动同文件中的 Token、Key 和白名单。
2. 同步更新 `docs/PERSONA.md`，避免运行配置和文档漂移。
3. 使用 `loadConfig()` 检查提示词能成功解析；输出名称存在、规则存在和长度等摘要即可。
4. 重启 Node 机器人。
5. 用“你叫什么名字？请用一句话介绍自己”测试名字、称呼和结尾规则。

模型提示词是行为引导而非绝对安全边界。需要百分之百保证的规则应在代码中实现，而不是只写提示词。当前 `/帮助`、`/重置`、限流和错误提示是程序直接回复，不经过人设模型。

## 8. 图片识别、生成与编辑流程

1. `src/onebot/message.ts` 从 OneBot 数组消息或 CQ 字符串中保留 `image` 段。
2. `src/onebot/image-loader.ts` 优先读取 NapCat 本地缓存路径，其次读取受信任的 QQ 图片域名，缺少直链时调用 `get_image`。
3. 图片会验证真实文件签名，再转换成 data URL；不信任扩展名或普通网页返回的 MIME 声明。
4. 当前限制为单张 8 MB、一次 4 张、总计 16 MB，仅允许 JPG、PNG、WebP 和 GIF。
5. `src/ai/codex-cli-ai.ts` 把验证后的 data URL 写入权限为 `600` 的单次临时文件，并通过 `codex exec --image` 传给 Codex；任务结束后删除临时工作区。
6. 用户明确要求生成或编辑图片时，Codex 调用内置图片生成功能。程序从 JSONL 的 `thread.started` 取得任务 ID，只读取 `~/.codex/generated_images/<thread-id>/` 下本次任务的图片，因此并发请求不会串图。
7. 生图要求中若出现不确定或不能按字面确定指代的网络梗、缩写、谐音、圈内称呼或专有词，Codex 必须先实时搜索并对照至少两条当前结果。仍有多义时先追问，本轮不生成；不能把词拆字后擅自拼成物件。
   当前群内约定“咕咕嘎嘎”默认指《明日方舟：终末地》的企鹅相关梗，但每次生图前仍需搜索当前视觉语境。
8. 生成图读取为 data URL 后，任务生成目录会清理；`src/onebot/reply.ts` 将其转换为 `base64://` OneBot 图片段并发送到 QQ，而不是把路径当文字回复。
9. 图片二进制不写入会话记忆。后续对话只保留“本轮附带图片”的文字标记、用户要求和 AI 文字回答。

若图片失败，先做纯文字 Codex 对照，再检查输入图片格式/大小、`codex login status`、额度和网络。图片生成通常需要一至数分钟，默认超时为 5 分钟。

## 9. 验证清单

代码修改后：

```bash
pnpm typecheck
pnpm test
pnpm build
```

macOS 启动逻辑修改后：

```bash
pnpm qq:verify-macos
```

实机验收按风险选择执行：

- 白名单主号私聊文字，确认 Codex 回复且保持铃铃酱人设。
- 询问当天最新信息，确认回复含可打开的来源链接。
- 私聊普通 JPG/PNG，确认能识别图片。
- 私聊发送“画一张绿色卡通猫爪”，确认 QQ 收到文字和真正的图片消息，而非本机路径。
- 附图发送“把背景改成夜晚”，确认返回编辑后的图片。
- 正常主号 QQ 与 NapCat 小号同时在线。
- 白名单群未 `@` 时不回复，`@铃铃酱` 时回复原消息。
- `/重置` 后旧上下文不再进入下一次请求。
- 人设测试包含“铃铃酱”“哥哥”和唯一的结尾“喵~”。

本项目测试包含一个临时监听本机随机端口的 WebSocket 测试；受限沙箱中若出现 `listen EPERM`，应在获得权限后重跑完整测试，不能把它当作业务代码失败。

## 10. 常见故障

### 普通 QQ 出现 `installPathPkgJson` JavaScript 错误

这是旧式 NapCat 注入残留或 QQ 更新入口未恢复造成的。不要继续手工改包。先运行 `pnpm qq:verify-macos`，再使用 `pnpm qq:start-napcat:macos` 的瞬时注入流程。当前加载器会在 NapCat 启动后立即恢复原版入口，并在失败时兜底恢复。

### NapCat 小号没有完整 QQ 界面

当前双启动设计中这是正常的：主号使用正常 QQ 界面，小号在 NapCat 后台运行。通过 WebUI、OneBot 端口和项目日志判断小号状态。

### `ECONNREFUSED 127.0.0.1:3001`

NapCat 未启动、正向 WebSocket 未启用或端口配置不一致。先检查 NapCat，再启动 Node 项目。

### 群内没有回复

依次确认：小号仍在群内、群号已进白名单、消息确实 `@` 了小号、Node 日志显示群白名单数量正确、Codex 没有报错。

### 人设没有更新

确认修改的是 `.env.local` 而非 `.env.example`，多行双引号正确闭合，并重启 Node 机器人。代码没有变化时不必重新构建。

### Codex 提示未登录、额度不足或调用失败

运行 `codex login status`。未登录时由机器所有者执行 `codex login`；已登录则检查 ChatGPT/Codex 额度、网络和 `codex --version`。不要把登录凭据写入 `.env.local`。

### 文字成功但图片生成超时

图片生成比普通文字慢。先用简单提示词重试，确认 `CODEX_TIMEOUT_MS` 至少为 `300000`；仍失败时查看 Node 日志和独立 `codex exec` 图片探针。不要为了绕过超时而开启 Shell 或电脑控制权限。

## 11. 新会话接手清单

1. 阅读 `AGENTS.md`、本文件和 `docs/PERSONA.md`。
2. 确认工作目录是 `/Users/why/code/my-project/qq-group-ai-bot`。
3. 不打印 `.env.local`；通过 `loadConfig()` 读取并只输出 Codex 模型、推理等级、搜索开关、白名单数量和人设布尔检查。
4. 检查正常 QQ、NapCat 小号和 Node 机器人是否仍在运行，避免重复启动。
5. 先复现问题，再修改最小范围。
6. 完成后执行与风险相称的测试、构建和实机验证，并把新的持久事实同步回本文。
