export class DeduplicationCache {
  private readonly seenAt = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number,
    private readonly now: () => number = Date.now,
  ) {}

  accept(key: string): boolean {
    const timestamp = this.now();
    const previous = this.seenAt.get(key);
    if (previous !== undefined && timestamp - previous < this.ttlMs) {
      return false;
    }

    this.seenAt.set(key, timestamp);
    this.prune(timestamp);
    return true;
  }

  private prune(timestamp: number): void {
    for (const [key, seenAt] of this.seenAt) {
      if (timestamp - seenAt >= this.ttlMs) this.seenAt.delete(key);
    }
    while (this.seenAt.size > this.maxSize) {
      const oldestKey = this.seenAt.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.seenAt.delete(oldestKey);
    }
  }
}

export class WindowRateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const timestamp = this.now();
    const cutoff = timestamp - this.windowMs;
    const current = (this.requests.get(key) ?? []).filter(
      (requestAt) => requestAt > cutoff,
    );

    if (current.length >= this.limit) {
      this.requests.set(key, current);
      return false;
    }
    current.push(timestamp);
    this.requests.set(key, current);
    return true;
  }
}
interface QueueState {
  tail: Promise<void>;
  pending: number;
}

export class KeyedTaskQueue {
  private readonly queues = new Map<string, QueueState>();

  constructor(private readonly maxPendingPerKey: number) {}

  enqueue(key: string, task: () => Promise<void>): boolean {
    let state = this.queues.get(key);
    if (!state) {
      state = { tail: Promise.resolve(), pending: 0 };
      this.queues.set(key, state);
    }
    if (state.pending >= this.maxPendingPerKey) return false;

    state.pending += 1;
    const currentState = state;
    const run = currentState.tail.catch(() => undefined).then(task);
    currentState.tail = run
      .catch(() => undefined)
      .finally(() => {
        currentState.pending -= 1;
        if (currentState.pending === 0) this.queues.delete(key);
      });
    return true;
  }
}
