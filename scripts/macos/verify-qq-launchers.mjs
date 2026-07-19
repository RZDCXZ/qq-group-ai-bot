#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qqAppDir = "/Applications/QQ.app/Contents/Resources/app";
const basePackagePath = path.join(qqAppDir, "package.json");
const versionsDir = path.join(
  os.homedir(),
  "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/versions",
);
const versionsConfigPath = path.join(versionsDir, "config.json");

const basePackage = JSON.parse(await readFile(basePackagePath, "utf8"));
assert.equal(
  basePackage.main,
  "./application.asar/app_launcher/index.js",
  "QQ 基础入口没有恢复为原版",
);

const versionsConfig = JSON.parse(await readFile(versionsConfigPath, "utf8"));
assert.match(versionsConfig.curVersion, /^\d+\.\d+\.\d+-\d+$/);

const updatePackagePath = path.join(
  versionsDir,
  versionsConfig.curVersion,
  "QQUpdate.app/Contents/Resources/app/package.json",
);
const updatePackage = JSON.parse(await readFile(updatePackagePath, "utf8"));
assert.equal(
  updatePackage.main,
  "./application.asar/app_launcher/index.js",
  "当前 QQ 更新入口没有恢复为原版",
);

const loaderPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "loadNapCat.js",
);
const loaderSource = await readFile(loaderPath, "utf8");
assert.match(
  loaderSource,
  /NAPCAT_LAUNCH_MODE/,
  "加载器缺少独立的 NapCat 模式环境标记",
);
assert.doesNotMatch(
  loaderSource,
  /global\.launcher|installPathPkgJson/,
  "普通 QQ 分支仍依赖不兼容的 global.launcher",
);
assert.match(
  loaderSource,
  /restoreOriginalEntry\(\)/,
  "NapCat 加载器没有在启动后恢复 QQ 原版入口",
);
assert.match(
  loaderSource,
  /spawn\("\/Applications\/QQ\.app\/Contents\/MacOS\/QQ"/,
  "NapCat 加载器缺少误触发时的原版 QQ 恢复启动",
);

console.log(`QQ 双启动配置检查通过（当前版本 ${versionsConfig.curVersion}）`);
