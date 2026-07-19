import { describe, expect, it, vi } from "vitest";

import type { AiService } from "../src/ai/types.js";
import { ConversationMemory } from "../src/conversation-memory.js";
import { createChatHandler } from "../src/group-chat-handler.js";

describe("GroupChatHandler", () => {
  it("携带同一成员的上下文，并在发送成功后写入记忆", async () => {
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValueOnce("第一答")
      .mockResolvedValueOnce("第二答");
    const handler = createChatHandler({
      ai: { generateReply },
      memory: new ConversationMemory({ maxTurns: 4 }),
    });
    const send = vi.fn().mockResolvedValue(undefined);

    await handler.handle(
      { scope: "group", groupId: "group-1", senderId: "alice", content: "第一问" },
      { send },
    );
    await handler.handle(
      { scope: "group", groupId: "group-1", senderId: "alice", content: "第二问" },
      { send },
    );

    expect(generateReply.mock.calls[1]?.[0]).toEqual([
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "第二问" },
    ]);
    expect(send).toHaveBeenNthCalledWith(2, "第二答");
  });

  it("按群和成员隔离会话，并支持重置", async () => {
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValue("回答");
    const handler = createChatHandler({
      ai: { generateReply },
      memory: new ConversationMemory({ maxTurns: 4 }),
    });
    const send = vi.fn().mockResolvedValue(undefined);

    await handler.handle(
      { scope: "group", groupId: "group-1", senderId: "alice", content: "秘密问题" },
      { send },
    );
    await handler.handle(
      { scope: "group", groupId: "group-1", senderId: "bob", content: "Bob 的问题" },
      { send },
    );
    await handler.handle(
      { scope: "group", groupId: "group-1", senderId: "alice", content: "/重置" },
      { send },
    );
    await handler.handle(
      { scope: "group", groupId: "group-1", senderId: "alice", content: "重新开始" },
      { send },
    );

    expect(generateReply.mock.calls[1]?.[0]).toEqual([
      { role: "user", content: "Bob 的问题" },
    ]);
    expect(generateReply.mock.calls[2]?.[0]).toEqual([
      { role: "user", content: "重新开始" },
    ]);
  });

  it("AI 回复发送失败时不污染上下文", async () => {
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValue("回答");
    const memory = new ConversationMemory({ maxTurns: 4 });
    const handler = createChatHandler({ ai: { generateReply }, memory });

    await expect(
      handler.handle(
        { scope: "group", groupId: "group-1", senderId: "alice", content: "问题" },
        { send: vi.fn().mockRejectedValue(new Error("QQ send failed")) },
      ),
    ).rejects.toThrow("QQ send failed");

    expect(memory.size()).toBe(0);
  });

  it("私聊支持直接提问和独立会话", async () => {
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValue("私聊回答");
    const handler = createChatHandler({
      ai: { generateReply },
      memory: new ConversationMemory({ maxTurns: 4 }),
    });
    const send = vi.fn().mockResolvedValue(undefined);

    await handler.handle(
      { scope: "private", senderId: "alice", content: "直接提问" },
      { send },
    );

    expect(generateReply).toHaveBeenCalledWith(
      [{ role: "user", content: "直接提问" }],
      undefined,
    );
    expect(send).toHaveBeenCalledWith("私聊回答");
  });

  it("支持纯图片提问，且后续记忆不保留图片二进制", async () => {
    const image = {
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      detail: "auto" as const,
    };
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValueOnce("这是一张测试图片")
      .mockResolvedValueOnce("延续回答");
    const handler = createChatHandler({
      ai: { generateReply },
      memory: new ConversationMemory({ maxTurns: 4 }),
    });
    const send = vi.fn().mockResolvedValue(undefined);

    await handler.handle(
      { scope: "private", senderId: "alice", content: "", images: [image] },
      { send },
    );
    await handler.handle(
      { scope: "private", senderId: "alice", content: "继续说" },
      { send },
    );

    expect(generateReply.mock.calls[0]?.[0]).toEqual([
      {
        role: "user",
        content: "请描述这张图片。",
        images: [image],
      },
    ]);
    expect(generateReply.mock.calls[1]?.[0]).toEqual([
      {
        role: "user",
        content: "请描述这张图片。\n[本轮附带 1 张图片，图片本身未保留。]",
      },
      { role: "assistant", content: "这是一张测试图片" },
      { role: "user", content: "继续说" },
    ]);
  });

  it("把 Codex 生成的图片交给 QQ 发送，并只把文字写入记忆", async () => {
    const generatedImage = {
      dataUrl: "data:image/png;base64,aW1hZ2U=",
    };
    const generateReply = vi
      .fn<AiService["generateReply"]>()
      .mockResolvedValue({ text: "画好啦喵~", images: [generatedImage] });
    const memory = new ConversationMemory({ maxTurns: 4 });
    const handler = createChatHandler({ ai: { generateReply }, memory });
    const send = vi.fn().mockResolvedValue(undefined);

    await handler.handle(
      { scope: "private", senderId: "alice", content: "画一只猫" },
      { send },
    );

    expect(send).toHaveBeenCalledWith("画好啦喵~", [generatedImage]);
    expect(memory.get("private:alice")).toEqual([
      { role: "user", content: "画一只猫" },
      { role: "assistant", content: "画好啦喵~" },
    ]);
  });
});
