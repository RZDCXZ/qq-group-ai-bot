const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const originalMain = "./application.asar/app_launcher/index.js";
const packagePath = path.join(process.resourcesPath, "app", "package.json");

function restoreOriginalEntry() {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (packageJson.main === originalMain) return;

  packageJson.main = originalMain;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

restoreOriginalEntry();

if (process.env.NAPCAT_LAUNCH_MODE === "1") {
  const napCatEntry = path.join(__dirname, "napcat", "napcat.mjs");
  import(pathToFileURL(napCatEntry).href).catch((error) => {
    console.error("NapCat 启动失败：", error);
    process.exitCode = 1;
  });
} else {
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.NAPCAT_LAUNCH_MODE;
  const qqProcess = spawn("/Applications/QQ.app/Contents/MacOS/QQ", [], {
    detached: true,
    env: cleanEnvironment,
    stdio: "ignore",
  });
  qqProcess.unref();
  process.exit(0);
}
