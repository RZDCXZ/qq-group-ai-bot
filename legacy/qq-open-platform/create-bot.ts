import {
  concurrencyGuard,
  contentSanitizer,
  errorHandler,
  FileKVStore,
  kvSessionPersistence,
  mentionGate,
  messageFilter,
  QQBot,
  rateLimiter,
  type Middleware,
} from "@tencent-connect/qqbot-nodejs";

import type { AiService } from "../../src/ai/types.js";
import type { ConversationMemory } from "../../src/conversation-memory.js";
import { UserFacingError } from "../../src/errors.js";
import { createGroupChatHandler } from "../../src/group-chat-handler.js";
import { logger } from "../../src/logger.js";
import { sendQQText } from "./reply.js";

interface LegacyOfficialConfig {
  qq: {
    appId: string;
    appSecret: string;
  };
  ai: {
    timeoutMs: number;
  };
  rateLimit: {
    maxRequests: number;
    windowMs: number;
  };
}

export function createLegacyOfficialRuntime(
  config: LegacyOfficialConfig,
  ai: AiService,
  memory: ConversationMemory,
) {
  const sessionStore = new FileKVStore({
    dir: "data",
    fileName: "qq-session.json",
    logger: { error: (message) => logger.error(message) },
  });
  const bot = new QQBot({
    appId: config.qq.appId,
    appSecret: config.qq.appSecret,
    accountId: config.qq.appId,
    transport: "websocket",
    tokenPrefetch: "sync",
    sessionPersistence: kvSessionPersistence({
      store: sessionStore,
      accountId: config.qq.appId,
    }),
    logger,
  });
  const handler = createGroupChatHandler({ ai, memory });

  bot.use(
    errorHandler({
      format: (error) =>
        error instanceof UserFacingError
          ? error.publicMessage
          : "暂时无法处理这条消息，请稍后重试。",
      rethrow: true,
    }),
    messageFilter({ dedup: { windowMs: 60_000, maxSize: 2_000 } }),
    groupOnly(),
    mentionGate({ requireMentionInGroup: true, ignoreOtherMentions: true }),
    contentSanitizer({ stripBotMention: true }),
    rateLimiter({
      perSender: {
        max: config.rateLimit.maxRequests,
        windowMs: config.rateLimit.windowMs,
      },
      perGroup: {
        max: Math.max(config.rateLimit.maxRequests * 5, 20),
        windowMs: config.rateLimit.windowMs,
      },
      global: {
        max: Math.max(config.rateLimit.maxRequests * 20, 100),
        windowMs: config.rateLimit.windowMs,
      },
      onLimit: async (context) => {
        await context.bot.sendText(
          context.replyTarget,
          "请求有点频繁，请稍后再试。",
        );
      },
    }),
    concurrencyGuard({
      strategy: "queue",
      maxQueue: 3,
      maxProcessingMs: config.ai.timeoutMs + 10_000,
      onDrop: async (context) => {
        await context.bot.sendText(
          context.replyTarget,
          "当前排队请求较多，请稍后重新发送。",
        );
      },
    }),
  );

  bot.on("message", async (context, message) => {
    if (message.kind !== "group" || !message.groupOpenid) return;
    await handler.handle(
      {
        groupId: message.groupOpenid,
        senderId: message.senderId,
        content: message.content,
      },
      { send: (text) => sendQQText(bot, message.replyTarget, text) },
      context.signal,
    );
  });

  return { bot, flush: () => sessionStore.flush() };
}

function groupOnly(): Middleware {
  return async (context, next) => {
    if (context.message.kind !== "group") {
      context.stop("group-only");
      return;
    }
    await next();
  };
}
