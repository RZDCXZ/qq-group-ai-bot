import type { AiGeneratedImage, AiService } from "./ai/types.js";
import type { AppConfig } from "./config.js";
import { ConversationMemory } from "./conversation-memory.js";
import { UserFacingError } from "./errors.js";
import { createChatHandler } from "./group-chat-handler.js";
import { logger } from "./logger.js";
import { OneBotWebSocketClient } from "./onebot/client.js";
import {
  OneBotImageLoader,
  type ImageLoader,
} from "./onebot/image-loader.js";
import { parseAllowedOneBotMessage } from "./onebot/message.js";
import { sendOneBotReply } from "./onebot/reply.js";
import type {
  OneBotActionCaller,
  OneBotEventHandler,
} from "./onebot/types.js";
import {
  DeduplicationCache,
  KeyedTaskQueue,
  WindowRateLimiter,
} from "./runtime-guards.js";

export interface OneBotClientPort extends OneBotActionCaller {
  start(eventHandler: OneBotEventHandler): Promise<void>;
  stop(): void;
}

export interface BotRuntime {
  start(): Promise<void>;
  stop(): void;
}

export function createBotRuntime(
  config: AppConfig,
  ai: AiService,
  memory: ConversationMemory,
  providedClient?: OneBotClientPort,
  providedImageLoader?: ImageLoader,
): BotRuntime {
  const client =
    providedClient ??
    new OneBotWebSocketClient(
      {
        url: config.oneBot.wsUrl,
        accessToken: config.oneBot.accessToken,
        reconnectIntervalMs: config.oneBot.reconnectIntervalMs,
        actionTimeoutMs: config.oneBot.actionTimeoutMs,
      },
      logger,
    );
  const imageLoader = providedImageLoader ?? new OneBotImageLoader(client);
  const handler = createChatHandler({ ai, memory });
  const deduplication = new DeduplicationCache(60_000, 2_000);
  const senderLimiter = new WindowRateLimiter(
    config.rateLimit.maxRequests,
    config.rateLimit.windowMs,
  );
  const chatLimiter = new WindowRateLimiter(
    Math.max(config.rateLimit.maxRequests * 5, 20),
    config.rateLimit.windowMs,
  );
  const globalLimiter = new WindowRateLimiter(
    Math.max(config.rateLimit.maxRequests * 20, 100),
    config.rateLimit.windowMs,
  );
  const queue = new KeyedTaskQueue(4);

  const onEvent: OneBotEventHandler = async (event) => {
    const message = parseAllowedOneBotMessage(
      event,
      config.oneBot.allowedGroupIds,
      config.oneBot.allowedPrivateUserIds,
    );
    if (!message) return;

    const chatId =
      message.scope === "group" ? message.groupId : message.senderId;
    const deduplicationKey = `${message.scope}:${chatId}:${message.messageId}`;
    if (!deduplication.accept(deduplicationKey)) return;

    const reply = {
      send: (text: string, images?: readonly AiGeneratedImage[]) =>
        sendOneBotReply(client, message, text, images),
    };
    const senderKey = `${message.scope}:${chatId}:${message.senderId}`;
    const allowed =
      senderLimiter.allow(senderKey) &&
      chatLimiter.allow(`${message.scope}:${chatId}`) &&
      globalLimiter.allow("global");
    if (!allowed) {
      await reply.send("请求有点频繁，请稍后再试。");
      return;
    }

    const accepted = queue.enqueue(senderKey, async () => {
      try {
        const { images: imageReferences, ...chatMessage } = message;
        const images = imageReferences?.length
          ? await imageLoader.load(imageReferences)
          : [];
        await handler.handle(
          {
            ...chatMessage,
            ...(images.length > 0 ? { images } : {}),
          },
          reply,
        );
      } catch (error) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        logger.error("[app] 处理 QQ 消息失败", {
          name: normalized.name,
          message: normalized.message,
          scope: message.scope,
          chatId,
          senderId: message.senderId,
        });
        const publicMessage =
          error instanceof UserFacingError
            ? error.publicMessage
            : "暂时无法处理这条消息，请稍后重试。";
        try {
          await reply.send(publicMessage);
        } catch (replyError) {
          const normalizedReplyError =
            replyError instanceof Error
              ? replyError
              : new Error(String(replyError));
          logger.error("[app] 发送错误提示失败", {
            message: normalizedReplyError.message,
          });
        }
      }
    });

    if (!accepted) {
      await reply.send("当前排队请求较多，请稍后重新发送。");
    }
  };

  return {
    start: async () => {
      await client.start(onEvent);
      logger.info("[app] QQ AI 机器人已就绪", {
        allowedGroupCount: config.oneBot.allowedGroupIds.size,
        allowedPrivateUserCount: config.oneBot.allowedPrivateUserIds.size,
      });
    },
    stop: () => client.stop(),
  };
}
