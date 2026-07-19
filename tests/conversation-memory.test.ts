import { describe, expect, it } from "vitest";

import { ConversationMemory } from "../src/conversation-memory.js";

describe("ConversationMemory", () => {
  it("只保留配置数量的最近轮次，并返回副本", () => {
    const memory = new ConversationMemory({ maxTurns: 2 });

    memory.appendTurn("alice", "问题 1", "回答 1");
    memory.appendTurn("alice", "问题 2", "回答 2");
    memory.appendTurn("alice", "问题 3", "回答 3");

    const messages = memory.get("alice");
    expect(messages.map((message) => message.content)).toEqual([
      "问题 2",
      "回答 2",
      "问题 3",
      "回答 3",
    ]);

    messages[0]!.content = "被篡改";
    expect(memory.get("alice")[0]?.content).toBe("问题 2");
  });

  it("清理过期会话", () => {
    let now = 1_000;
    const memory = new ConversationMemory({
      maxTurns: 2,
      ttlMs: 100,
      now: () => now,
    });

    memory.appendTurn("alice", "问题", "回答");
    now = 1_100;

    expect(memory.get("alice")).toEqual([]);
    expect(memory.size()).toBe(0);
  });

  it("达到上限时淘汰最久未使用的会话", () => {
    let now = 1;
    const memory = new ConversationMemory({
      maxTurns: 1,
      maxConversations: 2,
      now: () => now,
    });

    memory.appendTurn("alice", "A", "A1");
    now = 2;
    memory.appendTurn("bob", "B", "B1");
    now = 3;
    memory.get("bob");
    now = 4;
    memory.appendTurn("charlie", "C", "C1");

    expect(memory.get("alice")).toEqual([]);
    expect(memory.get("bob")).toHaveLength(2);
    expect(memory.get("charlie")).toHaveLength(2);
  });
});
