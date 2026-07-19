import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import {
  OpenAICompatibleAi,
  type OpenAICompatibleAiConfig,
} from "../src/ai/openai-compatible-ai.js";
import { UserFacingError } from "../src/errors.js";

function createConfig(
  mode: "responses" | "chat-completions",
): OpenAICompatibleAiConfig {
  return {
    baseUrl: "https://relay.example.com/v1",
    apiKey: "relay-key",
    model: "relay-model",
    mode,
    systemPrompt: "只用中文回答",
    maxOutputTokens: 321,
    timeoutMs: 5_000,
  };
}

describe("OpenAICompatibleAi", () => {
  it("通过中转站 Responses API 请求，且关闭服务端存储", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = input instanceof Request ? input.url : String(input);
      const bodyText =
        input instanceof Request
          ? await input.clone().text()
          : String(init?.body ?? "{}");
      capturedBody = JSON.parse(bodyText) as Record<string, unknown>;
      return Response.json({ output_text: "  中转站回答  " });
    });
    const client = new OpenAI({
      apiKey: "relay-key",
      baseURL: "https://relay.example.com/v1",
      maxRetries: 0,
      fetch: fetchMock,
    });
    const ai = new OpenAICompatibleAi(createConfig("responses"), client);

    const answer = await ai.generateReply([
      { role: "user", content: "你好" },
    ]);

    expect(answer).toBe("中转站回答");
    expect(capturedUrl).toBe("https://relay.example.com/v1/responses");
    expect(capturedBody).toMatchObject({
      model: "relay-model",
      instructions: "只用中文回答",
      max_output_tokens: 321,
      store: false,
      input: [{ role: "user", content: "你好" }],
    });
  });

  it("支持只有 Chat Completions 的中转站", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = input instanceof Request ? input.url : String(input);
      const bodyText =
        input instanceof Request
          ? await input.clone().text()
          : String(init?.body ?? "{}");
      capturedBody = JSON.parse(bodyText) as Record<string, unknown>;
      return Response.json({
        choices: [{ message: { role: "assistant", content: "聊天回答" } }],
      });
    });
    const client = new OpenAI({
      apiKey: "relay-key",
      baseURL: "https://relay.example.com/v1",
      maxRetries: 0,
      fetch: fetchMock,
    });
    const ai = new OpenAICompatibleAi(
      createConfig("chat-completions"),
      client,
    );

    const answer = await ai.generateReply([
      { role: "assistant", content: "旧回答" },
      { role: "user", content: "继续" },
    ]);

    expect(answer).toBe("聊天回答");
    expect(capturedUrl).toBe(
      "https://relay.example.com/v1/chat/completions",
    );
    expect(capturedBody).toMatchObject({
      model: "relay-model",
      max_tokens: 321,
      messages: [
        { role: "system", content: "只用中文回答" },
        { role: "assistant", content: "旧回答" },
        { role: "user", content: "继续" },
      ],
    });
  });

  it("通过 Responses API 向中转站发送图片输入", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    let capturedBody: Record<string, unknown> = {};
    const client = new OpenAI({
      apiKey: "relay-key",
      baseURL: "https://relay.example.com/v1",
      maxRetries: 0,
      fetch: async (input, init) => {
        const bodyText =
          input instanceof Request
            ? await input.clone().text()
            : String(init?.body ?? "{}");
        capturedBody = JSON.parse(bodyText) as Record<string, unknown>;
        return Response.json({ output_text: "图片回答" });
      },
    });
    const ai = new OpenAICompatibleAi(createConfig("responses"), client);

    await expect(
      ai.generateReply([
        { role: "assistant", content: "之前的回答" },
        {
          role: "user",
          content: "图里有什么？",
          images: [{ dataUrl, detail: "auto" }],
        },
      ]),
    ).resolves.toBe("图片回答");

    expect(capturedBody.input).toEqual([
      { role: "assistant", content: "之前的回答" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "图里有什么？" },
          {
            type: "input_image",
            image_url: dataUrl,
            detail: "auto",
          },
        ],
      },
    ]);
  });

  it("通过 Chat Completions API 向中转站发送图片输入", async () => {
    const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    let capturedBody: Record<string, unknown> = {};
    const client = new OpenAI({
      apiKey: "relay-key",
      baseURL: "https://relay.example.com/v1",
      maxRetries: 0,
      fetch: async (input, init) => {
        const bodyText =
          input instanceof Request
            ? await input.clone().text()
            : String(init?.body ?? "{}");
        capturedBody = JSON.parse(bodyText) as Record<string, unknown>;
        return Response.json({
          choices: [{ message: { role: "assistant", content: "图片回答" } }],
        });
      },
    });
    const ai = new OpenAICompatibleAi(
      createConfig("chat-completions"),
      client,
    );

    await ai.generateReply([
      {
        role: "user",
        content: "读出图片文字",
        images: [{ dataUrl, detail: "high" }],
      },
    ]);

    expect(capturedBody.messages).toEqual([
      { role: "system", content: "只用中文回答" },
      {
        role: "user",
        content: [
          { type: "text", text: "读出图片文字" },
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
          },
        ],
      },
    ]);
  });

  it("在 Responses 路径不存在时给出切换模式提示", async () => {
    const client = new OpenAI({
      apiKey: "relay-key",
      baseURL: "https://relay.example.com/v1",
      maxRetries: 0,
      fetch: async () =>
        Response.json(
          { error: { message: "not found", type: "not_found" } },
          { status: 404 },
        ),
    });
    const ai = new OpenAICompatibleAi(createConfig("responses"), client);

    await expect(
      ai.generateReply([{ role: "user", content: "你好" }]),
    ).rejects.toMatchObject<UserFacingError>({
      publicMessage:
        "中转站未提供 Responses 接口，请把 AI_API_MODE 改为 chat-completions。",
    });
  });
});
