import { describe, expect, it } from "vitest";

import { ConfigurationError, parseConfig } from "../src/config.js";

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ONEBOT_ACCESS_TOKEN: "onebot-token",
    ONEBOT_ALLOWED_GROUP_IDS: "123456789, 987654321",
    ...overrides,
  };
}

describe("parseConfig", () => {
  it("使用受限 Codex CLI 并填充安全默认值", () => {
    const config = parseConfig(validEnv());

    expect(config.ai.command).toBe("codex");
    expect(config.ai.model).toBe("gpt-5.6-sol");
    expect(config.ai.reasoningEffort).toBe("medium");
    expect(config.ai.liveSearch).toBe(true);
    expect(config.ai.timeoutMs).toBe(300_000);
    expect(config.ai.maxConcurrent).toBe(2);
    expect(config.ai.maxQueue).toBe(12);
    expect(config.conversation.maxTurns).toBe(8);
    expect(config.conversation.ttlMs).toBe(24 * 60 * 60 * 1_000);
    expect(config.oneBot.wsUrl).toBe("ws://127.0.0.1:3001");
    expect([...config.oneBot.allowedGroupIds]).toEqual([
      "123456789",
      "987654321",
    ]);
    expect(config.oneBot.allowedPrivateUserIds.size).toBe(0);
  });

  it("支持只启用好友私聊白名单", () => {
    const config = parseConfig(
      validEnv({
        ONEBOT_ALLOWED_GROUP_IDS: "",
        ONEBOT_ALLOWED_PRIVATE_USER_IDS: "20002, 30003",
      }),
    );

    expect(config.oneBot.allowedGroupIds.size).toBe(0);
    expect([...config.oneBot.allowedPrivateUserIds]).toEqual(["20002", "30003"]);
  });

  it("支持覆盖 Codex 模型、推理、搜索和并发配置", () => {
    const config = parseConfig(
      validEnv({
        CODEX_COMMAND: "/opt/bin/codex",
        CODEX_MODEL: "gpt-5.6-terra",
        CODEX_REASONING_EFFORT: "high",
        CODEX_LIVE_SEARCH: "false",
        CODEX_TIMEOUT_MS: "180000",
        CODEX_MAX_CONCURRENT: "1",
        CODEX_MAX_QUEUE: "4",
      }),
    );

    expect(config.ai).toMatchObject({
      command: "/opt/bin/codex",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      liveSearch: false,
      timeoutMs: 180_000,
      maxConcurrent: 1,
      maxQueue: 4,
    });
  });

  it("支持覆盖会话轮数和闲置过期时间", () => {
    const config = parseConfig(
      validEnv({
        CONVERSATION_MAX_TURNS: "30",
        CONVERSATION_TTL_MS: "172800000",
      }),
    );

    expect(config.conversation).toEqual({
      maxTurns: 30,
      ttlMs: 2 * 24 * 60 * 60 * 1_000,
    });
  });

  it("拒绝非法 Codex 配置", () => {
    expect(() =>
      parseConfig(validEnv({ CODEX_MODEL: "gpt-5.6-sol; rm" })),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseConfig(validEnv({ CODEX_LIVE_SEARCH: "yes" })),
    ).toThrow(ConfigurationError);
  });

  it("拒绝非 WebSocket 地址和非法群号", () => {
    expect(() =>
      parseConfig(
        validEnv({
          ONEBOT_WS_URL: "https://127.0.0.1:3001",
          ONEBOT_ALLOWED_GROUP_IDS: "123456789,*",
        }),
      ),
    ).toThrow(ConfigurationError);
  });

  it("拒绝非法私聊 QQ 号以及两个空白名单", () => {
    expect(() =>
      parseConfig(
        validEnv({
          ONEBOT_ALLOWED_GROUP_IDS: "",
          ONEBOT_ALLOWED_PRIVATE_USER_IDS: "20002,*",
        }),
      ),
    ).toThrow(ConfigurationError);

    expect(() =>
      parseConfig(
        validEnv({
          ONEBOT_ALLOWED_GROUP_IDS: "",
          ONEBOT_ALLOWED_PRIVATE_USER_IDS: "",
        }),
      ),
    ).toThrow(ConfigurationError);
  });
});
