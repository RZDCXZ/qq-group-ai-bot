# 本机双 QQ 机器人共存说明

本文记录麦麦与铃铃酱在同一台 Mac 上长期共存的本机部署方式。文档不保存 QQ 号、群号、Token 或 API Key；真实值只保存在已忽略提交的本地配置中。

## 当前架构

- 铃铃酱使用 macOS NapCat，WebUI 位于宿主机 `6099`，OneBot 正向 WebSocket 位于宿主机 `3001`。
- 麦麦使用 Docker Compose 中独立的 `core` 与 `napcat` 容器。麦麦 NapCat WebUI 映射为宿主机 `16099`，内部 OneBot WebSocket 使用 Docker 网络中的 `napcat:3001`，不映射到宿主机。
- 麦麦 WebUI 映射为宿主机 `18001`。
- 麦麦的两个 WebUI 端口只绑定 `127.0.0.1`，不会暴露到局域网。
- 两套 NapCat 使用不同的数据目录和 QQ 小号，不能让任一 NapCat 登录主号。

## 地址与端口速查

| 用途 | 本机访问地址 | 说明 |
| --- | --- | --- |
| 铃铃酱 NapCat WebUI | `http://127.0.0.1:6099/webui` | 管理铃铃酱的小号登录和 OneBot 网络配置 |
| 铃铃酱 OneBot WebSocket | `ws://127.0.0.1:3001` | 供 `qq-group-ai-bot` 连接，不是浏览器页面 |
| 麦麦 NapCat WebUI | `http://127.0.0.1:16099/webui` | 管理麦麦的小号登录和 OneBot 网络配置 |
| 麦麦 MaiBot WebUI | `http://127.0.0.1:18001` | 管理麦麦配置、插件、聊天流和记忆 |
| 麦麦容器内 OneBot WebSocket | `ws://napcat:3001` | 只在 Docker 网络内使用，宿主机不能直接访问 |

看到 WebUI 自动跳转到 `/webui/web_login` 属于正常现象。`6099` 与 `16099` 是两个完全不同的 NapCat，登录前先核对浏览器地址，避免改错机器人。

## Token 类型与获取方法

两套机器人涉及多种 Token，不能混用：

| Token | 用途 | 应该填在哪里 |
| --- | --- | --- |
| NapCat WebUI Token | 登录 NapCat 管理页面 | `6099` 或 `16099` 的 Web Login 页面 |
| MaiBot WebUI Access Token | 登录麦麦管理页面 | `18001` 的登录页面 |
| OneBot WebSocket Token | 机器人程序连接 NapCat | OneBot 网络配置和对应机器人本地配置 |
| PackyAPI / Embedding API Key | 调用模型服务 | 麦麦 `model_config.toml`，不能填到任何 WebUI 登录页 |

所有 Token 都属于敏感信息。下面的命令只在本机执行，不要把命令输出粘贴到聊天、群聊、截图或提交记录中。

### 铃铃酱 NapCat WebUI Token（端口 6099）

Token 保存在 macOS QQ 容器内的 NapCat 配置中。以下命令会直接复制 Token 到剪贴板，不在终端打印：

```bash
node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(d.token)' "/Users/why/Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/NapCat/config/webui.json" | pbcopy
```

然后打开 `http://127.0.0.1:6099/webui`，在 Token 输入框粘贴并登录。

若需要人工查看配置文件，可执行：

```bash
open "/Users/why/Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/NapCat/config/webui.json"
```

只读取其中的 `token` 字段，不要修改其他字段。

### 麦麦 NapCat WebUI Token（端口 16099）

在 MaiBot 项目目录执行：

```bash
cd /Users/why/code/my-project/MaiBot
node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(d.token)' docker-config/napcat/webui.json | pbcopy
```

然后打开 `http://127.0.0.1:16099/webui`，粘贴并登录。

也可以从容器启动日志中查看，但日志会把 Token 明文显示在终端：

```bash
docker compose logs napcat | grep "WebUi Token" | tail -1
```

### 麦麦 MaiBot WebUI Access Token（端口 18001）

MaiBot WebUI 使用另一套独立 Token。当前 Token 保存在持久化数据文件中；以下命令将它复制到剪贴板：

```bash
cd /Users/why/code/my-project/MaiBot
node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(d.access_token)' data/MaiMBot/webui.json | pbcopy
```

然后打开 `http://127.0.0.1:18001`，粘贴并登录。若麦麦核心重启后 Token 发生变化，重新执行上面的命令获取最新值。

日志查看方式如下，同样会在终端显示明文：

```bash
docker compose logs core | grep "WebUI 登录 Token" | tail -1
```

### OneBot WebSocket Token

- 铃铃酱程序使用 `/Users/why/code/my-project/qq-group-ai-bot/.env.local` 中的 `ONEBOT_ACCESS_TOKEN`，它必须与铃铃酱 NapCat `3001` WebSocket 服务器配置中的 Token 完全一致。
- 麦麦使用 `data/MaiMBot/plugins/MaiBot-Napcat-Adapter/config.toml` 中的适配器 Token，它必须与麦麦 Docker NapCat 内部 `3001` WebSocket 服务器配置一致。
- OneBot Token 不是 WebUI 登录密码。WebUI 提示输入 Token 时，不要把 OneBot Token、PackyAPI Key 或 Codex 登录信息填进去。

MaiBot 官方 Docker 文档说明了 `core`、`napcat`、持久化目录和适配器连接方式：

- https://docs.mai-mai.org/manual/deployment/docker
- https://docs.mai-mai.org/manual/adapters/napcat

NapCat Docker 官方仓库说明 `/app/.config/QQ` 用于持久化登录信息：

- https://github.com/NapNeko/NapCat-Docker

## 本地配置边界

- `docker-config/mmc/bot_config.toml`：麦麦账号、人设、聊天和记忆配置。
- `docker-config/mmc/model_config.toml`：PackyAPI 对话模型与免费 Embedding 配置。
- `data/MaiMBot/plugins/MaiBot-Napcat-Adapter/config.toml`：NapCat 地址、私聊/群聊名单和过滤规则。
- `.env`：只保存 Compose 快速登录所需的本地账号变量，已被 Git 忽略。
- `docker-config/napcat/` 与 `data/qq/`：麦麦 NapCat 配置和 QQ 登录状态。

上述含敏感信息的文件保持 `600` 权限。检查配置时只输出字段是否存在、列表数量和连接状态，不能打印真实值。

当前对话模型通过 PackyAPI 使用 DeepSeek；长期记忆 Embedding 实际使用免费 `BAAI/bge-m3`，两者是不同服务，属于正常配置。未配置 VLM 时，麦麦不能可靠识图。

## 启动、停止和查看日志

在 `/Users/why/code/my-project/MaiBot` 中执行：

```bash
docker compose up -d
docker compose ps
docker compose logs -f core
```

仅重启麦麦核心，不重登 QQ：

```bash
docker compose restart core
```

停止麦麦：

```bash
docker compose stop
```

再次启动时使用：

```bash
docker compose start
```

Compose 服务配置了 `restart: always`。Docker Desktop 启动后容器会自动恢复；QQ 登录状态保存在 `data/qq/`。若 QQ 风控使登录失效，仍需打开 `http://127.0.0.1:16099` 或扫描容器日志生成的二维码重新授权。

铃铃酱仍在自己的项目中管理，不要用模糊的 `pkill` 或停止麦麦容器的方式管理它：

```bash
cd /Users/why/code/my-project/qq-group-ai-bot
pnpm status
pnpm restart
```

## 电脑重启后的完整启动顺序

1. 启动 Docker Desktop，等待菜单栏显示 Docker 已就绪。
2. 启动麦麦：

```bash
cd /Users/why/code/my-project/MaiBot
docker compose up -d
docker compose ps
```

3. `core` 和 `napcat` 都显示 `running` 后，检查麦麦日志：

```bash
docker compose logs --tail=100 core
```

4. 启动铃铃酱 NapCat 小号（如果尚未运行）：

```bash
cd /Users/why/code/my-project/qq-group-ai-bot
pnpm qq:start-napcat:macos
```

5. 启动铃铃酱 AI 回复程序；合盖长期运行使用：

```bash
pnpm start:awake
```

6. 分别用主号私聊两个机器人确认回复。若麦麦 QQ 登录失效，打开 `16099` 重新扫码；若铃铃酱 QQ 登录失效，打开 `6099` 处理。

停止麦麦全部容器：

```bash
cd /Users/why/code/my-project/MaiBot
docker compose stop
```

只停止铃铃酱 AI 回复、不退出铃铃酱 NapCat 小号：

```bash
cd /Users/why/code/my-project/qq-group-ai-bot
pnpm stop
```

不要使用 `pkill node`、`killall QQ` 或模糊的 Docker 删除命令，否则可能误停普通主号 QQ 或另一套机器人。

## 登录与连接排障顺序

1. 先核对访问端口：铃铃酱 NapCat 是 `6099`，麦麦 NapCat 是 `16099`，麦麦 WebUI 是 `18001`。
2. WebUI Token 报错时，从对应的 `webui.json` 重新复制，不能借用另一套机器人的 Token。
3. 页面打不开时检查进程：铃铃酱运行 `pnpm status`；麦麦运行 `docker compose ps`。
4. 麦麦页面能打开但 QQ 离线时查看 `docker compose logs napcat`，必要时重新扫码。
5. 麦麦 QQ 在线但不回复时查看 `docker compose logs core`，确认出现“NapCat 适配器已连接”。
6. 铃铃酱 QQ 在线但不回复时，确认 `pnpm status` 正常，并检查 `.env.local` 的 WebSocket 地址和 OneBot Token 是否与铃铃酱 NapCat 一致。

## 验收流程

1. `docker compose ps` 中麦麦 `core` 与 `napcat` 都应为 `Up`。
2. 麦麦日志应出现“NapCat 适配器已连接”和“消息网关已激活”。
3. `pnpm status` 应显示铃铃酱正在运行。
4. 主号分别私聊麦麦和铃铃酱，确认都能独立回复。
5. 在目标群分别 `@麦麦`、`@铃铃酱`，确认两个账号都能收到并回复。
6. 查看麦麦日志，确认回复模型调用成功、Embedding 初始化成功且没有名单过滤错误。

## 已知边界

- 两个机器人当前没有互相加入忽略名单，这是明确保留的现状。若它们在群里持续互相接话，应立即先停掉其中一个，再决定是否增加互相忽略规则。
- 麦麦适配器默认启用名单过滤。新增群后，必须在适配器配置中加入真实群号，否则 NapCat 已连接也不会处理群消息。
- 不要把 `16099`、`18001` 或 OneBot WebSocket 映射到公网。
