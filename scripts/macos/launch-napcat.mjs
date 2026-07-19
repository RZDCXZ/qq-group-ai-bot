#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  copyFileSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const originalMain = "./application.asar/app_launcher/index.js";
const qqBinary = "/Applications/QQ.app/Contents/MacOS/QQ";
const qqAccount = process.argv[2];

if (!/^\d+$/.test(qqAccount ?? "")) {
  console.error("NapCat 小号必须是纯数字 QQ 号。");
  process.exit(1);
}

const qqDataDir = path.join(
  os.homedir(),
  "Library/Containers/com.tencent.qq/Data",
);
const versionsDir = path.join(
  qqDataDir,
  "Library/Application Support/QQ/versions",
);
const versionsConfig = JSON.parse(
  readFileSync(path.join(versionsDir, "config.json"), "utf8"),
);
const packagePath = path.join(
  versionsDir,
  versionsConfig.curVersion,
  "QQUpdate.app/Contents/Resources/app/package.json",
);
const loaderPath = path.join(qqDataDir, "Documents/loadNapCat.js");
const projectLoaderPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "loadNapCat.js",
);
const loaderMain = path.relative(path.dirname(packagePath), loaderPath);

function setMain(main) {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (packageJson.main === main) return;
  if (packageJson.main !== originalMain && packageJson.main !== loaderMain) {
    throw new Error(`拒绝覆盖未知的 QQ 启动入口：${packageJson.main}`);
  }

  packageJson.main = main;
  const temporaryPath = `${packagePath}.napcat-${process.pid}.tmp`;
  const mode = statSync(packagePath).mode;
  writeFileSync(temporaryPath, `${JSON.stringify(packageJson, null, 2)}\n`, {
    mode,
  });
  renameSync(temporaryPath, packagePath);
}

let restored = false;
function restoreOriginalEntry() {
  if (restored) return;
  setMain(originalMain);
  restored = true;
}

copyFileSync(projectLoaderPath, loaderPath);
setMain(loaderMain);

const qqProcess = spawn(
  qqBinary,
  ["--no-sandbox", "-q", qqAccount],
  {
    env: { ...process.env, NAPCAT_LAUNCH_MODE: "1" },
    stdio: "inherit",
  },
);

const fallbackTimer = setTimeout(() => {
  try {
    restoreOriginalEntry();
  } catch (error) {
    console.error("恢复 QQ 原版入口失败：", error);
  }
}, 5000);

qqProcess.once("error", (error) => {
  clearTimeout(fallbackTimer);
  restoreOriginalEntry();
  console.error("启动 NapCat QQ 失败：", error);
  process.exitCode = 1;
});

qqProcess.once("exit", (code, signal) => {
  clearTimeout(fallbackTimer);
  restoreOriginalEntry();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    clearTimeout(fallbackTimer);
    restoreOriginalEntry();
    qqProcess.kill(signal);
  });
}
