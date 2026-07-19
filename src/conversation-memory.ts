import type { AiMessage } from "./ai/types.js";

interface ConversationRecord {
  messages: AiMessage[];
  touchedAt: number;
}

export interface ConversationMemoryOptions {
  maxTurns: number;
  maxConversations?: number;
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_CONVERSATIONS = 1_000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

export class ConversationMemory {
  private readonly records = new Map<string, ConversationRecord>();
  private readonly maxTurns: number;
  private readonly maxConversations: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ConversationMemoryOptions) {
    if (!Number.isInteger(options.maxTurns) || options.maxTurns < 1) {
      throw new RangeError("maxTurns 必须是大于 0 的整数");
    }

    this.maxTurns = options.maxTurns;
    this.maxConversations =
      options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get(key: string): AiMessage[] {
    const record = this.records.get(key);
    if (!record) return [];

    const now = this.now();
    if (now - record.touchedAt >= this.ttlMs) {
      this.records.delete(key);
      return [];
    }

    record.touchedAt = now;
    return record.messages.map((message) => ({ ...message }));
  }

  appendTurn(key: string, userContent: string, assistantContent: string): void {
    const now = this.now();
    this.pruneExpired(now);

    let record = this.records.get(key);
    if (!record) {
      this.evictOldestIfFull();
      record = { messages: [], touchedAt: now };
      this.records.set(key, record);
    }

    record.messages.push(
      { role: "user", content: userContent },
      { role: "assistant", content: assistantContent },
    );
    record.messages = record.messages.slice(-(this.maxTurns * 2));
    record.touchedAt = now;
  }

  clear(key: string): boolean {
    return this.records.delete(key);
  }

  size(): number {
    this.pruneExpired(this.now());
    return this.records.size;
  }

  private pruneExpired(now: number): void {
    for (const [key, record] of this.records) {
      if (now - record.touchedAt >= this.ttlMs) {
        this.records.delete(key);
      }
    }
  }

  private evictOldestIfFull(): void {
    if (this.records.size < this.maxConversations) return;

    let oldestKey: string | undefined;
    let oldestTimestamp = Number.POSITIVE_INFINITY;
    for (const [key, record] of this.records) {
      if (record.touchedAt < oldestTimestamp) {
        oldestTimestamp = record.touchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.records.delete(oldestKey);
    }
  }
}
