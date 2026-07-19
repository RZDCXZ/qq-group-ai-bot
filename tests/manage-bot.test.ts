import { describe, expect, it } from "vitest";

import {
  isBotCommand,
  parseProcessTable,
  selectProjectBotProcesses,
} from "../scripts/macos/manage-bot.mjs";

describe("机器人进程管理", () => {
  it("解析 ps 输出并识别 start 启动的 Node 机器人", () => {
    const processes = parseProcessTable(
      "  101 node dist/index.js\n  202 /usr/bin/node /tmp/other/dist/index.js\n",
    );

    expect(processes).toEqual([
      { pid: 101, command: "node dist/index.js" },
      { pid: 202, command: "/usr/bin/node /tmp/other/dist/index.js" },
    ]);
    expect(isBotCommand(processes[0]!.command)).toBe(true);
    expect(isBotCommand("node scripts/macos/launch-napcat.mjs 123")).toBe(false);
  });

  it("同时核对工作目录，不会选中其他项目的 dist/index.js", () => {
    const processes = [
      { pid: 101, command: "node dist/index.js" },
      { pid: 202, command: "/usr/bin/node /tmp/other/dist/index.js" },
    ];
    const cwdByPid = new Map([
      [101, "/project/qq-group-ai-bot"],
      [202, "/tmp/other"],
    ]);

    expect(
      selectProjectBotProcesses(
        processes,
        "/project/qq-group-ai-bot",
        (pid) => cwdByPid.get(pid),
      ),
    ).toEqual([{ pid: 101, command: "node dist/index.js" }]);
  });
});
