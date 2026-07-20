#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = realpathSync(path.resolve(path.dirname(scriptPath), "../.."));
const maiBotRoot = path.resolve(projectRoot, "../MaiBot");
const allBots = process.argv.includes("--all");
const action = process.argv[2] ?? "status";

const dockerEnvironment = {
  ...process.env,
  LOCAL_UID: String(process.getuid?.() ?? 1000),
  LOCAL_GID: String(process.getgid?.() ?? 1000),
};

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: dockerEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runLingling(...args) {
  run(
    "docker",
    ["compose", "--env-file", ".env.local", "-f", "compose.yaml", ...args],
    projectRoot,
  );
}

function runMaiBot(...args) {
  const composePath = path.join(maiBotRoot, "docker-compose.yml");
  if (!existsSync(composePath)) {
    throw new Error(`未找到同级 MaiBot 项目：${composePath}`);
  }
  run("docker", ["compose", "-f", composePath, ...args], maiBotRoot);
}

function printTitle(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

switch (action) {
  case "start":
    if (allBots) runMaiBot("up", "-d");
    runLingling("up", "-d", "--build");
    break;
  case "stop":
    runLingling("down");
    if (allBots) runMaiBot("down");
    break;
  case "restart":
    runLingling("down");
    if (allBots) {
      runMaiBot("down");
      runMaiBot("up", "-d");
    }
    runLingling("up", "-d", "--build");
    break;
  case "status":
    if (allBots) {
      printTitle("麦麦");
      runMaiBot("ps");
      printTitle("铃铃酱");
    }
    runLingling("ps");
    break;
  case "logs":
    if (allBots) {
      throw new Error("合并日志容易混淆账号，请分别使用各项目的日志命令。");
    }
    runLingling("logs", "--tail", "200", "-f");
    break;
  default:
    throw new Error(
      `未知操作：${action}；可用值为 start、stop、restart、status、logs。`,
    );
}
