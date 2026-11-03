type Fields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
}

/** One JSON line per entry; journald keeps the timestamp. */
export function jsonLogger(debugEnabled = false): Logger {
  const write = (level: string, message: string, fields?: Fields) => {
    const line = JSON.stringify({ level, message, ...fields });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return {
    debug: (message, fields) => {
      if (debugEnabled) write("debug", message, fields);
    },
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
