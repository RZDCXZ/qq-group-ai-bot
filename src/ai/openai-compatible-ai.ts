import OpenAI from "openai";

import { UserFacingError } from "../errors.js";
import type {
  AiMessage,
  AiService,
  GenerateReplyOptions,
} from "./types.js";

export interface OpenAICompatibleAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  mode: "responses" | "chat-completions";
  systemPrompt: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

export class OpenAICompatibleAi implements AiService {
  private readonly client: OpenAI;

  constructor(
    private readonly config: OpenAICompatibleAiConfig,
    client?: OpenAI,
  ) {
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
        maxRetries: 1,
      });
  }

  async generateReply(
    messages: readonly AiMessage[],
    options: GenerateReplyOptions = {},
  ): Promise<string> {
    try {
      const text =
        this.config.mode === "responses"
          ? await this.createResponse(messages, options.signal)
          : await this.createChatCompletion(messages, options.signal);

      const normalized = text.trim();
      if (!normalized) {
        throw new UserFacingError("中转站返回了空内容，请稍后重试。");
      }
      return normalized;
    } catch (error) {
      if (error instanceof UserFacingError) {
        throw error;
      }
      throw mapRelayError(error, this.config.mode, options.signal);
    }
  }

  private async createResponse(
    messages: readonly AiMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.client.responses.create(
      {
        model: this.config.model,
        instructions: this.config.systemPrompt,
        input: messages.map(toResponsesMessage),
        max_output_tokens: this.config.maxOutputTokens,
        store: false,
      },
      signal ? { signal } : undefined,
    );
    return response.output_text;
  }

  private async createChatCompletion(
    messages: readonly AiMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.client.chat.completions.create(
      {
        model: this.config.model,
        messages: [
          { role: "system", content: this.config.systemPrompt },
          ...messages.map(toChatCompletionMessage),
        ],
        max_tokens: this.config.maxOutputTokens,
      },
      signal ? { signal } : undefined,
    );
    return response.choices[0]?.message.content ?? "";
  }
}

function toResponsesMessage(message: AiMessage) {
  if (message.role !== "user" || !message.images?.length) {
    return { role: message.role, content: message.content };
  }

  return {
    role: "user" as const,
    content: [
      { type: "input_text" as const, text: message.content },
      ...message.images.map((image) => ({
        type: "input_image" as const,
        image_url: image.dataUrl,
        detail: image.detail,
      })),
    ],
  };
}

function toChatCompletionMessage(message: AiMessage) {
  if (message.role !== "user" || !message.images?.length) {
    return { role: message.role, content: message.content };
  }

  return {
    role: "user" as const,
    content: [
      { type: "text" as const, text: message.content },
      ...message.images.map((image) => ({
        type: "image_url" as const,
        image_url: { url: image.dataUrl, detail: image.detail },
      })),
    ],
  };
}

function mapRelayError(
  error: unknown,
  mode: "responses" | "chat-completions",
  signal?: AbortSignal,
): UserFacingError {
  if (signal?.aborted || hasErrorName(error, "AbortError")) {
    return new UserFacingError("本次请求已取消，请重新发送。", { cause: error });
  }

  const status = readStatus(error);
  if (status === 401 || status === 403) {
    return new UserFacingError("中转站鉴权失败，请检查中转站密钥和模型权限。", {
      cause: error,
    });
  }
  if (status === 404) {
    const hint =
      mode === "responses"
        ? "中转站未提供 Responses 接口，请把 AI_API_MODE 改为 chat-completions。"
        : "中转站未提供 Chat Completions 接口，请检查 AI_BASE_URL。";
    return new UserFacingError(hint, { cause: error });
  }
  if (status === 429) {
    return new UserFacingError("中转站请求受限，请检查余额、配额或稍后再试。", {
      cause: error,
    });
  }
  if (status !== undefined && status >= 500) {
    return new UserFacingError("中转站暂时不可用，请稍后重试。", { cause: error });
  }
  if (hasErrorName(error, "APIConnectionTimeoutError")) {
    return new UserFacingError("中转站响应超时，请稍后重试。", { cause: error });
  }

  return new UserFacingError("调用中转站失败，请稍后重试。", { cause: error });
}

function hasErrorName(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

function readStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const status = Reflect.get(error, "status");
  return typeof status === "number" ? status : undefined;
}
