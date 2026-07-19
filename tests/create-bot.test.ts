import { describe, expect, it, vi } from "vitest";

import type { AiService } from "../src/ai/types.js";
import { parseConfig } from "../src/config.js";
import { ConversationMemory } from "../src/conversation-memory.js";
import {
  createBotRuntime,
  type OneBotClientPort,
} from "../src/create-bot.js";
import type { ImageLoader } from "../src/onebot/image-loader.js";
import type { OneBotEventHandler } from "../src/onebot/types.js";

class FakeOneBotClient implements OneBotClientPort {
  readonly callMock = vi.fn().mockResolvedValue({ message_id: "reply-id" });
  readonly stopMock = vi.fn();
  private eventHandler: OneBotEventHandler | undefined;

  async start(eventHandler: OneBotEventHandler): Promise<void> {
    this.eventHandler = eventHandler;
  }

  stop(): void {
    this.stopMock();
  }

  async call<T = unknown>(
    action: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    return (await this.callMock(action, params)) as T;
  }

  async emit(event: unknown): Promise<void> {
    if (!this.eventHandler) throw new Error("client has not started");
    await this.eventHandler(event);
  }
}

function createConfig(overrides: Record<string, string | undefined> = {}) {
  return parseConfig({
    ONEBOT_ACCESS_TOKEN: "onebot-token",
    ONEBOT_ALLOWED_GROUP_IDS: "10001",
    ...overrides,
  });
}

describe("OneBot 机器人运行时", () => {
  it("把白名单群中的 @消息交给 AI 并回复原消息", async () => {
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValue("Codex 回答");
    const client = new FakeOneBotClient();
    const runtime = createBotRuntime(
      createConfig(),
      { generateReply },
      new ConversationMemory({ maxTurns: 4 }),
      client,
    );
    await runtime.start();

    await client.emit({
      post_type: "message",
      message_type: "group",
      self_id: "90009",
      user_id: "20002",
      group_id: "10001",
      message_id: "30003",
      message: [
        { type: "at", data: { qq: "90009" } },
        { type: "text", data: { text: "解释一下闭包" } },
      ],
    });

    await vi.waitFor(() => expect(client.callMock).toHaveBeenCalledTimes(1));
    expect(generateReply).toHaveBeenCalledWith(
      [{ role: "user", content: "解释一下闭包" }],
      undefined,
    );
    expect(client.callMock).toHaveBeenCalledWith("send_group_msg", {
      group_id: "10001",
      message: [
        { type: "reply", data: { id: "30003" } },
        { type: "at", data: { qq: "20002" } },
        { type: "text", data: { text: " Codex 回答" } },
      ],
    });

    runtime.stop();
    expect(client.stopMock).toHaveBeenCalledOnce();
  });

  it("把白名单好友的私聊消息交给 AI 并直接回复", async () => {
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValue("私聊测试成功");
    const client = new FakeOneBotClient();
    const runtime = createBotRuntime(
      createConfig({
        ONEBOT_ALLOWED_GROUP_IDS: "",
        ONEBOT_ALLOWED_PRIVATE_USER_IDS: "20002",
      }),
      { generateReply },
      new ConversationMemory({ maxTurns: 4 }),
      client,
    );
    await runtime.start();

    await client.emit({
      post_type: "message",
      message_type: "private",
      self_id: "90009",
      user_id: "20002",
      message_id: "40004",
      message: [{ type: "text", data: { text: "只回复测试成功" } }],
    });

    await vi.waitFor(() => expect(client.callMock).toHaveBeenCalledTimes(1));
    expect(generateReply).toHaveBeenCalledWith(
      [{ role: "user", content: "只回复测试成功" }],
      undefined,
    );
    expect(client.callMock).toHaveBeenCalledWith("send_private_msg", {
      user_id: "20002",
      message: [{ type: "text", data: { text: "私聊测试成功" } }],
    });

    runtime.stop();
  });

  it("先解析 NapCat 图片，再把多模态私聊交给 AI", async () => {
    const aiImage = {
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      detail: "auto" as const,
    };
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValue("图片识别成功");
    const load = vi
      .fn<ImageLoader["load"]>()
      .mockResolvedValue([aiImage]);
    const client = new FakeOneBotClient();
    const runtime = createBotRuntime(
      createConfig({
        ONEBOT_ALLOWED_GROUP_IDS: "",
        ONEBOT_ALLOWED_PRIVATE_USER_IDS: "20002",
      }),
      { generateReply },
      new ConversationMemory({ maxTurns: 4 }),
      client,
      { load },
    );
    await runtime.start();

    await client.emit({
      post_type: "message",
      message_type: "private",
      self_id: "90009",
      user_id: "20002",
      message_id: "50005",
      message: [
        {
          type: "image",
          data: {
            file: "qq-image.png",
            url: "https://gchat.qpic.cn/example.png",
            file_size: 1024,
          },
        },
      ],
    });

    await vi.waitFor(() => expect(client.callMock).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledWith([
      {
        file: "qq-image.png",
        url: "https://gchat.qpic.cn/example.png",
        fileSize: 1024,
      },
    ]);
    expect(generateReply).toHaveBeenCalledWith(
      [
        {
          role: "user",
          content: "请描述这张图片。",
          images: [aiImage],
        },
      ],
      undefined,
    );
    expect(client.callMock).toHaveBeenCalledWith("send_private_msg", {
      user_id: "20002",
      message: [{ type: "text", data: { text: "图片识别成功" } }],
    });

    runtime.stop();
  });

  it("把 Codex 生成图片作为 OneBot 图片段发给好友", async () => {
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValue({
        text: "画好了喵~",
        images: [{ dataUrl: "data:image/png;base64,aW1hZ2U=" }],
      });
    const client = new FakeOneBotClient();
    const runtime = createBotRuntime(
      createConfig({
        ONEBOT_ALLOWED_GROUP_IDS: "",
        ONEBOT_ALLOWED_PRIVATE_USER_IDS: "20002",
      }),
      { generateReply },
      new ConversationMemory({ maxTurns: 4 }),
      client,
    );
    await runtime.start();

    await client.emit({
      post_type: "message",
      message_type: "private",
      self_id: "90009",
      user_id: "20002",
      message_id: "60006",
      message: [{ type: "text", data: { text: "画一只猫" } }],
    });

    await vi.waitFor(() => expect(client.callMock).toHaveBeenCalledTimes(1));
    expect(client.callMock).toHaveBeenCalledWith("send_private_msg", {
      user_id: "20002",
      message: [
        { type: "text", data: { text: "画好了喵~" } },
        { type: "image", data: { file: "base64://aW1hZ2U=" } },
      ],
    });

    runtime.stop();
  });
});
