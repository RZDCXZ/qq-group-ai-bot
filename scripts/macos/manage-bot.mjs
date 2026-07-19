#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = realpathSync(path.resolve(path.dirname(scriptPath), "../.."));
const STOP_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

export function parseProcessTable(output) {
  return output
    .split(/\r?\n/)
    .map((line) => /^\s*(\d+)\s+(.+?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), command: match[2] }));
}

export function isBotCommand(command) {
  return /(?:^|\/)node\s+(?:\S*\/)?dist\/index\.js(?:\s|$)/.test(command);
}

export function selectProjectBotProcesses(processes, expectedRoot, cwdForPid) {
  return processes.filter(
    (processInfo) =>
      isBotCommand(processInfo.command) &&
      cwdForPid(processInfo.pid) === expectedRoot,
  );
}

function readProcessTable() {
  const output = execFileSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
  });
  return parseProcessTable(output);
}

function readProcessCwd(pid) {
  try {
    const output = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const pathLine = output.split(/\r?\n/).find((line) => line.startsWith("n"));
    return pathLine ? realpathSync(pathLine.slice(1)) : undefined;
  } catch {
    return undefined;
  }
}

function findBotProcesses() {
  return selectProjectBotProcesses(
    readProcessTable(),
    projectRoot,
    readProcessCwd,
  );
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForStopped(pids) {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isAlive(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return pids.every((pid) => !isAlive(pid));
}

function printStatus(processes) {
  if (processes.length === 0) {
    console.log("QQ AI 机器人未运行；NapCat 小号不会因此退出。");
    return;
  }
  const pids = processes.map((processInfo) => processInfo.pid).join(", ");
  console.log(`QQ AI 机器人正在运行（PID ${pids}）。`);
}

async function stopBot() {
  const processes = findBotProcesses();
  if (processes.length === 0) {
    printStatus(processes);
    return;
  }

  for (const processInfo of processes) {
    process.kill(processInfo.pid, "SIGTERM");
  }
  const stopped = await waitForStopped(
    processes.map((processInfo) => processInfo.pid),
  );
  if (!stopped) {
    const pids = processes.map((processInfo) => processInfo.pid).join(", ");
    throw new Error(`机器人未在 5 秒内退出（PID ${pids}），未自动强制结束。`);
  }
  console.log("QQ AI 机器人已安全关闭；NapCat 小号仍保持在线。");
}

async function startBot() {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : "pnpm";
  const args = npmExecPath ? [npmExecPath, "start"] : ["start"];
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

async function main() {
  const action = process.argv[2] ?? "status";
  switch (action) {
    case "status":
      printStatus(findBotProcesses());
      break;
    case "stop":
      await stopBot();
      break;
    case "restart":
      await stopBot();
      await startBot();
      break;
    default:
      throw new Error(`未知操作：${action}；可用值为 status、stop、restart。`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`管理机器人失败：${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
