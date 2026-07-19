export type AiRole = "user" | "assistant";

export interface AiImage {
  dataUrl: string;
  detail: "auto" | "low" | "high";
}

export interface AiGeneratedImage {
  dataUrl: string;
}

export interface AiReply {
  text: string;
  images?: readonly AiGeneratedImage[];
}

export type AiReplyResult = string | AiReply;

export interface AiMessage {
  role: AiRole;
  content: string;
  images?: readonly AiImage[];
}

export interface GenerateReplyOptions {
  signal?: AbortSignal;
}

export interface AiService {
  generateReply(
    messages: readonly AiMessage[],
    options?: GenerateReplyOptions,
  ): Promise<AiReplyResult>;
}
