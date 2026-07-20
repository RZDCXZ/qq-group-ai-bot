# QQ 双机器人本机管理

本目录统一放置两个独立 Git 项目：

- `lingling-bot/`：铃铃酱，Codex + NapCat。
- `MaiBot/`：麦麦，PackyAPI + NapCat。

Docker Desktop 就绪后，直接在本目录执行：

```bash
pnpm start
pnpm status
pnpm restart:core
pnpm restart
pnpm stop
```

日常修改配置或业务代码后优先使用 `pnpm restart:core`。它只重建麦麦和铃铃酱的
业务核心，两个 NapCat 容器和 QQ 登录进程保持不动。`pnpm restart` 会重建整套容器，
仅在 NapCat 本身也需要重建时使用。

QQ 登录失效时：

```bash
pnpm bots:login      # 检查两者，只为离线账号打开二维码
pnpm login:lingling  # 只处理铃铃酱
pnpm login:maibot    # 只处理麦麦
```

查看日志：

```bash
pnpm logs:lingling
pnpm logs:maibot
```

日志命令按 `Control + C` 只退出查看，不会停止机器人。敏感配置、QQ 登录状态和
Token 仍分别保存在两个项目已忽略提交的本地文件中。
