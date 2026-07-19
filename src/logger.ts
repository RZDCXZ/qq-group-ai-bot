export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

function write(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  meta?: Record<string, unknown>,
): void {
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  console[level](`${new Date().toISOString()} ${message}${suffix}`);
}

export const logger: Logger = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
  debug: (message, meta) => {
    if (process.env.LOG_LEVEL === "debug") {
      write("debug", message, meta);
    }
  },
};
