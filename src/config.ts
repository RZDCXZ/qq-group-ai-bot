import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const integerFromEnv = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : Number(value)),
    z.number().int().min(min).max(max),
  );

const booleanFromEnv = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return value;
  }, z.boolean());

const oneBotUrlSchema = z
  .string()
  .trim()
  .url("必须是完整 WebSocket URL，例如 ws://127.0.0.1:3001")
  .superRefine((value, context) => {
    const protocol = new URL(value).protocol;
    if (protocol !== "ws:" && protocol !== "wss:") {
      context.addIssue({
        code: "custom",
        message: "协议必须是 ws:// 或 wss://",
      });
    }
  });

const numericIdListSchema = (label: string) =>
  z
    .string()
    .trim()
    .default("")
    .transform((value, context) => {
    const ids = [
      ...new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    const invalid = ids.filter((item) => !/^\d+$/.test(item));
    if (invalid.length > 0) {
      context.addIssue({
        code: "custom",
        message: `${label}只能包含数字，多个号码用英文逗号分隔：${invalid.join(", ")}`,
      });
      return z.NEVER;
    }
    return ids;
  });

const envSchema = z
  .object({
    ONEBOT_WS_URL: oneBotUrlSchema.default("ws://127.0.0.1:3001"),
    ONEBOT_ACCESS_TOKEN: z
      .string()
      .trim()
      .min(1, "ONEBOT_ACCESS_TOKEN 不能为空"),
    ONEBOT_ALLOWED_GROUP_IDS: numericIdListSchema("群号"),
    ONEBOT_ALLOWED_PRIVATE_USER_IDS: numericIdListSchema("私聊 QQ 号"),
    ONEBOT_RECONNECT_INTERVAL_MS: integerFromEnv(5_000, 1_000, 60_000),
    ONEBOT_ACTION_TIMEOUT_MS: integerFromEnv(10_000, 1_000, 60_000),
    CODEX_COMMAND: z.string().trim().min(1).default("codex"),
    CODEX_MODEL: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]+$/, "CODEX_MODEL 包含非法字符")
      .default("gpt-5.6-sol"),
    CODEX_REASONING_EFFORT: z
      .enum(["low", "medium", "high", "xhigh"])
      .default("medium"),
    CODEX_LIVE_SEARCH: booleanFromEnv(true),
    CODEX_TIMEOUT_MS: integerFromEnv(300_000, 30_000, 600_000),
    CODEX_MAX_CONCURRENT: integerFromEnv(2, 1, 4),
    CODEX_MAX_QUEUE: integerFromEnv(12, 0, 100),
    AI_SYSTEM_PROMPT: z
      .string()
      .trim()
      .min(1)
      .default("你是 QQ 里的 AI 助手。请使用简洁、友善、准确的中文回答。"),
    CONVERSATION_MAX_TURNS: integerFromEnv(8, 1, 50),
    CONVERSATION_TTL_MS: integerFromEnv(
      24 * 60 * 60 * 1_000,
      60_000,
      30 * 24 * 60 * 60 * 1_000,
    ),
    RATE_LIMIT_MAX_REQUESTS: integerFromEnv(6, 1, 100),
    RATE_LIMIT_WINDOW_MS: integerFromEnv(60_000, 1_000, 3_600_000),
  })
  .superRefine((value, context) => {
    if (
      value.ONEBOT_ALLOWED_GROUP_IDS.length === 0 &&
      value.ONEBOT_ALLOWED_PRIVATE_USER_IDS.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["ONEBOT_ALLOWED_PRIVATE_USER_IDS"],
        message: "群白名单和私聊白名单至少填写一项",
      });
    }
  });

export interface AppConfig {
  oneBot: {
    wsUrl: string;
    accessToken: string;
    allowedGroupIds: ReadonlySet<string>;
    allowedPrivateUserIds: ReadonlySet<string>;
    reconnectIntervalMs: number;
    actionTimeoutMs: number;
  };
  ai: {
    command: string;
    model: string;
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
    systemPrompt: string;
    timeoutMs: number;
    liveSearch: boolean;
    maxConcurrent: number;
    maxQueue: number;
  };
  conversation: {
    maxTurns: number;
    ttlMs: number;
  };
  rateLimit: {
    maxRequests: number;
    windowMs: number;
  };
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function parseConfig(
  env: Record<string, string | undefined>,
): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "配置"}: ${issue.message}`)
      .join("\n");
    throw new ConfigurationError(`环境变量配置有误：\n${details}`);
  }

  const parsed = result.data;
  return {
    oneBot: {
      wsUrl: parsed.ONEBOT_WS_URL.replace(/\/+$/, ""),
      accessToken: parsed.ONEBOT_ACCESS_TOKEN,
      allowedGroupIds: new Set(parsed.ONEBOT_ALLOWED_GROUP_IDS),
      allowedPrivateUserIds: new Set(parsed.ONEBOT_ALLOWED_PRIVATE_USER_IDS),
      reconnectIntervalMs: parsed.ONEBOT_RECONNECT_INTERVAL_MS,
      actionTimeoutMs: parsed.ONEBOT_ACTION_TIMEOUT_MS,
    },
    ai: {
      command: parsed.CODEX_COMMAND,
      model: parsed.CODEX_MODEL,
      reasoningEffort: parsed.CODEX_REASONING_EFFORT,
      systemPrompt: parsed.AI_SYSTEM_PROMPT,
      timeoutMs: parsed.CODEX_TIMEOUT_MS,
      liveSearch: parsed.CODEX_LIVE_SEARCH,
      maxConcurrent: parsed.CODEX_MAX_CONCURRENT,
      maxQueue: parsed.CODEX_MAX_QUEUE,
    },
    conversation: {
      maxTurns: parsed.CONVERSATION_MAX_TURNS,
      ttlMs: parsed.CONVERSATION_TTL_MS,
    },
    rateLimit: {
      maxRequests: parsed.RATE_LIMIT_MAX_REQUESTS,
      windowMs: parsed.RATE_LIMIT_WINDOW_MS,
    },
  };
}

export function loadConfig(): AppConfig {
  loadDotenv({ path: ".env.local", quiet: true });
  return parseConfig(process.env);
}
