import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { AiImage } from "../ai/types.js";
import { UserFacingError } from "../errors.js";
import type { OneBotImageReference } from "./message.js";
import type { OneBotActionCaller } from "./types.js";

const DEFAULT_MAX_IMAGES = 4;
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

const TRUSTED_QQ_IMAGE_DOMAINS = [
  "qq.com",
  "qq.com.cn",
  "qpic.cn",
  "gtimg.cn",
  "qlogo.cn",
] as const;

export interface OneBotImageLoaderOptions {
  fetch?: typeof globalThis.fetch;
  maxImages?: number;
  maxImageBytes?: number;
  maxTotalBytes?: number;
  timeoutMs?: number;
}

export interface ImageLoader {
  load(
    references: readonly OneBotImageReference[],
    signal?: AbortSignal,
  ): Promise<AiImage[]>;
}

export class OneBotImageLoader implements ImageLoader {
  private readonly fetch: typeof globalThis.fetch;
  private readonly maxImages: number;
  private readonly maxImageBytes: number;
  private readonly maxTotalBytes: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly caller: OneBotActionCaller,
    options: OneBotImageLoaderOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
    this.maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async load(
    references: readonly OneBotImageReference[],
    signal?: AbortSignal,
  ): Promise<AiImage[]> {
    if (references.length > this.maxImages) {
      throw new UserFacingError(`一次最多识别 ${this.maxImages} 张图片。`);
    }

    const images: AiImage[] = [];
    let totalBytes = 0;
    for (const reference of references) {
      if (
        reference.fileSize !== undefined &&
        reference.fileSize > this.maxImageBytes
      ) {
        throw imageTooLargeError(this.maxImageBytes);
      }

      const bytes = await this.loadReference(reference, signal);
      if (bytes.byteLength > this.maxImageBytes) {
        throw imageTooLargeError(this.maxImageBytes);
      }

      totalBytes += bytes.byteLength;
      if (totalBytes > this.maxTotalBytes) {
        throw new UserFacingError("图片总大小过大，请减少图片数量后重试。");
      }

      const mimeType = detectImageMimeType(bytes);
      if (!mimeType) {
        throw unsupportedImageError();
      }
      images.push({
        dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
        detail: "auto",
      });
    }
    return images;
  }

  private async loadReference(
    reference: OneBotImageReference,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    try {
      if (reference.path && isAbsolute(reference.path)) {
        return await this.readLocalFile(reference.path);
      }

      if (reference.url) {
        const direct = await this.readDirectSource(reference.url, signal);
        if (direct) return direct;
      }

      if (reference.file) {
        const direct = await this.readDirectSource(reference.file, signal);
        if (direct) return direct;

        const resolved = await this.caller.call<unknown>("get_image", {
          file: reference.file,
        });
        const resolvedBytes = await this.readResolvedImage(resolved, signal);
        if (resolvedBytes) return resolvedBytes;
      }
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      throw unreadableImageError(error);
    }

    throw unreadableImageError();
  }

  private async readResolvedImage(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<Buffer | null> {
    if (!isRecord(input)) return null;

    const base64 = readNonEmptyString(input.base64);
    if (base64) {
      const source = base64.startsWith("data:") || base64.startsWith("base64://")
        ? base64
        : `base64://${base64}`;
      return await this.readDirectSource(source, signal);
    }

    for (const field of ["path", "file", "url"] as const) {
      const source = readNonEmptyString(input[field]);
      if (!source) continue;
      const bytes = await this.readDirectSource(source, signal);
      if (bytes) return bytes;
    }
    return null;
  }

  private async readDirectSource(
    source: string,
    signal?: AbortSignal,
  ): Promise<Buffer | null> {
    if (source.startsWith("base64://")) {
      return this.decodeBase64(source.slice("base64://".length));
    }
    if (source.startsWith("data:")) {
      return this.decodeDataUrl(source);
    }
    if (isAbsolute(source)) {
      return await this.readLocalFile(source);
    }

    let url: URL;
    try {
      url = new URL(source);
    } catch {
      return null;
    }
    assertTrustedQqImageUrl(url);
    return await this.download(url, signal);
  }

  private async readLocalFile(path: string): Promise<Buffer> {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw unreadableImageError();
    if (metadata.size > this.maxImageBytes) {
      throw imageTooLargeError(this.maxImageBytes);
    }
    return await readFile(path);
  }

  private async download(url: URL, signal?: AbortSignal): Promise<Buffer> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let currentUrl = url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.fetch(currentUrl, {
        signal: requestSignal,
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) {
          throw unreadableImageError();
        }
        currentUrl = new URL(location, currentUrl);
        assertTrustedQqImageUrl(currentUrl);
        continue;
      }
      if (!response.ok) throw unreadableImageError();

      const declaredLength = readContentLength(response.headers);
      if (declaredLength !== undefined && declaredLength > this.maxImageBytes) {
        throw imageTooLargeError(this.maxImageBytes);
      }
      return await readResponseWithLimit(response, this.maxImageBytes);
    }
    throw unreadableImageError();
  }

  private decodeDataUrl(source: string): Buffer {
    const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(source);
    if (!match) throw unsupportedImageError();
    return this.decodeBase64(match[2] ?? "");
  }

  private decodeBase64(source: string): Buffer {
    const compact = source.replace(/\s/g, "");
    if (Math.ceil((compact.length * 3) / 4) > this.maxImageBytes) {
      throw imageTooLargeError(this.maxImageBytes);
    }
    return Buffer.from(compact, "base64");
  }
}

async function readResponseWithLimit(
  response: Response,
  limit: number,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw imageTooLargeError(limit);
    }
    chunks.push(Buffer.from(result.value));
  }
  return Buffer.concat(chunks, total);
}

function assertTrustedQqImageUrl(url: URL): void {
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    !isTrustedQqImageHost(url.hostname)
  ) {
    throw new UserFacingError("无法安全读取这张图片，请重新发送原图。");
  }
}

function isTrustedQqImageHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return TRUSTED_QQ_IMAGE_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function detectImageMimeType(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes.subarray(1, 4).toString("ascii") === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
      bytes.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }
  return null;
}

function readContentLength(headers: Headers): number | undefined {
  const value = headers.get("content-length");
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function imageTooLargeError(limit: number): UserFacingError {
  return new UserFacingError(
    `图片过大，请发送不超过 ${Math.floor(limit / 1024 / 1024)} MB 的图片。`,
  );
}

function unsupportedImageError(): UserFacingError {
  return new UserFacingError(
    "图片格式不支持，请发送 JPG、PNG、WebP 或 GIF 图片。",
  );
}

function unreadableImageError(cause?: unknown): UserFacingError {
  return new UserFacingError("暂时无法读取这张 QQ 图片，请重新发送。", {
    cause,
  });
}

function readNonEmptyString(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  return input.trim() || undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
