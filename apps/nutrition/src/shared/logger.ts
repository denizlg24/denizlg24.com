export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  [key: string]: unknown;
}

const serializeError = (error: Error) => ({
  message: error.message,
  name: error.name,
  stack: error.stack,
});

class Logger {
  log(level: LogLevel, message: string, context: LogContext = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    };

    const line = JSON.stringify(entry);

    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  debug(message: string, context?: LogContext) {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext) {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log("warn", message, context);
  }

  error(message: string, error: Error, context?: LogContext) {
    this.log("error", message, {
      ...context,
      error: serializeError(error),
    });
  }
}

export const logger = new Logger();
