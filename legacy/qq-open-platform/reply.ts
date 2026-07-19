import type { QQBot, ReplyTarget } from "@tencent-connect/qqbot-nodejs";

const QQ_SAFE_CHUNK_LENGTH = 4_300;
const QQ_MAX_PASSIVE_REPLIES = 5;
const TRUNCATED_SUFFIX = "\n（回复过长，已截断）";

export function splitReplyText(
  input: string,
  chunkLength = QQ_SAFE_CHUNK_LENGTH,
  maxChunks = QQ_MAX_PASSIVE_REPLIES,
): string[] {
  if (chunkLength < 20 || maxChunks < 1) {
    throw new RangeError("无效的 QQ 消息分段配置");
  }

  let text = input.trim();
  if (!text) return [];

  const maximumLength = chunkLength * maxChunks;
  if (text.length > maximumLength) {
    text = `${text.slice(0, maximumLength - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`;
  }

  const chunks: string[] = [];
  while (text.length > chunkLength) {
    const splitAt = findNaturalBoundary(text, chunkLength);
    chunks.push(text.slice(0, splitAt).trim());
    text = text.slice(splitAt).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
}

export async function sendQQText(
  bot: Pick<QQBot, "sendText">,
  target: ReplyTarget,
  text: string,
): Promise<void> {
  const chunks = splitReplyText(text);
  if (chunks.length === 0) return;

  for (const [index, chunk] of chunks.entries()) {
    const prefix = chunks.length > 1 ? `（${index + 1}/${chunks.length}）\n` : "";
    await bot.sendText(target, `${prefix}${chunk}`);
  }
}

function findNaturalBoundary(text: string, limit: number): number {
  const minimum = Math.floor(limit * 0.55);
  const candidates = ["\n", "。", "！", "？", "；", " "];
  let best = -1;

  for (const separator of candidates) {
    const index = text.lastIndexOf(separator, limit - 1);
    const boundary = index + separator.length;
    if (index >= 0 && boundary >= minimum) {
      best = Math.max(best, boundary);
    }
  }

  return best > 0 ? best : limit;
}
