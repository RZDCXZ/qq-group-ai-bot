import { describe, expect, it } from "vitest";

import {
  DeduplicationCache,
  KeyedTaskQueue,
  WindowRateLimiter,
} from "../src/runtime-guards.js";

describe("运行时保护", () => {
  it("在去重窗口内拒绝同一消息", () => {
    let now = 1_000;
    const cache = new DeduplicationCache(100, 10, () => now);

    expect(cache.accept("message-1")).toBe(true);
    expect(cache.accept("message-1")).toBe(false);
    now = 1_100;
    expect(cache.accept("message-1")).toBe(true);
  });

  it("按滑动窗口限制请求数", () => {
    let now = 1_000;
    const limiter = new WindowRateLimiter(2, 100, () => now);

    expect(limiter.allow("alice")).toBe(true);
    expect(limiter.allow("alice")).toBe(true);
    expect(limiter.allow("alice")).toBe(false);
    now = 1_101;
    expect(limiter.allow("alice")).toBe(true);
  });

  it("同一成员的任务串行执行并限制排队长度", async () => {
    const queue = new KeyedTaskQueue(2);
    const order: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    expect(
      queue.enqueue("alice", async () => {
        order.push("first:start");
        markFirstStarted();
        await firstDone;
        order.push("first:end");
      }),
    ).toBe(true);
    expect(
      queue.enqueue("alice", async () => {
        order.push("second");
      }),
    ).toBe(true);
    expect(queue.enqueue("alice", async () => undefined)).toBe(false);

    await firstStarted;
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await firstDone;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});
