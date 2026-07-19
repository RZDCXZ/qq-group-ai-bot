export type OneBotId = string | number;

export interface OneBotMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

export interface OneBotActionCaller {
  call<T = unknown>(
    action: string,
    params: Record<string, unknown>,
  ): Promise<T>;
}

export type OneBotEventHandler = (
  event: unknown,
) => void | Promise<void>;
