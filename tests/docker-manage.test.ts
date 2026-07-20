import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = path.resolve(projectRoot, "..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Docker 双机器人管理", () => {
  it("restart:core 只重建业务核心，不停止或重建 NapCat", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "qq-bots-docker-test-"),
    );
    temporaryDirectories.push(temporaryDirectory);

    const callsFile = path.join(temporaryDirectory, "docker-calls.txt");
    const dockerStub = path.join(temporaryDirectory, "docker");
    await writeFile(
      dockerStub,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_CALLS_FILE"\n',
      "utf8",
    );
    await chmod(dockerStub, 0o755);

    const result = spawnSync(
      "pnpm",
      ["-C", workspaceRoot, "run", "restart:core"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DOCKER_CALLS_FILE: callsFile,
          PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const calls = (await readFile(callsFile, "utf8")).trim().split("\n");
    expect(calls).toEqual([
      `compose -f ${path.join(workspaceRoot, "MaiBot/docker-compose.yml")} up -d --no-deps --force-recreate core`,
      "compose --env-file .env.local -f compose.yaml up -d --build --no-deps --force-recreate core",
    ]);
    expect(calls.join(" ")).not.toMatch(/\bdown\b|\bnapcat\b/i);
  });
});
