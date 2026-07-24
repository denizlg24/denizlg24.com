import {
  TERMINAL_SESSION_PREFIX,
  type TerminalSession,
  terminalSessionIdSchema,
} from "@repo/schemas/cloud";
import { spawn as spawnPty } from "bun-pty";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const HISTORY_LINES = 100_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const INHERITED_ENV_NAMES = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TMUX_TMPDIR",
  "USER",
] as const;

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface AttachedTmuxClient {
  close(): void;
  pauseOutput(): void;
  resize(size: TerminalSize): void;
  resumeOutput(): void;
  write(data: string | Uint8Array): void;
}

export interface AttachTmuxOptions {
  onData(data: Uint8Array): void;
  onExit(): void;
  size?: TerminalSize;
}

export interface TmuxSessionManagerOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
  socketName?: string;
  tmuxBinary?: string;
}

function isoFromUnixSeconds(value: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("tmux returned an invalid session timestamp");
  }
  return new Date(seconds * 1_000).toISOString();
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
}

export class TmuxSessionManager {
  private readonly cwd: string;
  private readonly env: Record<string, string>;
  private readonly now: () => number;
  private readonly socketName: string;
  private readonly tmuxBinary: string;

  constructor(options: TmuxSessionManagerOptions = {}) {
    this.cwd = options.cwd ?? process.env.HOME ?? process.cwd();
    const inheritedEnv = Object.fromEntries(
      INHERITED_ENV_NAMES.flatMap((name) => {
        const value = process.env[name];
        return value === undefined ? [] : [[name, value]];
      }),
    );
    this.env = {
      ...inheritedEnv,
      ...options.env,
      TERM: "xterm-256color",
    };
    this.now = options.now ?? Date.now;
    this.socketName = options.socketName ?? "cloud-terminal";
    this.tmuxBinary = options.tmuxBinary ?? Bun.which("tmux") ?? "tmux";
  }

  private command(args: string[]): string[] {
    return [this.tmuxBinary, "-L", this.socketName, ...args];
  }

  private async run(
    args: string[],
    options: { allowNoServer?: boolean } = {},
  ): Promise<string> {
    const process = Bun.spawn(this.command(args), {
      cwd: this.cwd,
      env: this.env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (exitCode !== 0) {
      if (
        options.allowNoServer &&
        /no server running|failed to connect to server|error connecting to/i.test(
          stderr,
        )
      ) {
        return "";
      }
      throw new Error(
        `tmux ${args[0] ?? "command"} failed: ${stderr.trim() || exitCode}`,
      );
    }
    return stdout;
  }

  private target(id: string): string {
    return `${TERMINAL_SESSION_PREFIX}${terminalSessionIdSchema.parse(id)}`;
  }

  private async ensureSession(id: string, size: TerminalSize): Promise<void> {
    const target = this.target(id);
    const exists = await this.run(["has-session", "-t", target])
      .then(() => true)
      .catch((error) => {
        if (
          error instanceof Error &&
          /can't find session|no server running|failed to connect|error connecting to/i.test(
            error.message,
          )
        ) {
          return false;
        }
        throw error;
      });
    if (!exists) {
      await this.run([
        "start-server",
        ";",
        "set-option",
        "-g",
        "exit-empty",
        "off",
        ";",
        "set-option",
        "-g",
        "history-limit",
        String(HISTORY_LINES),
        ";",
        "new-session",
        "-d",
        "-s",
        target,
        "-x",
        String(size.cols),
        "-y",
        String(size.rows),
      ]).catch(async (error) => {
        // Two simultaneous first attaches may race to create the same session.
        await this.run(["has-session", "-t", target]).catch(() => {
          throw error;
        });
      });
    }
    await Promise.all([
      this.run(["set-option", "-t", target, "destroy-unattached", "off"]),
      this.run([
        "set-option",
        "-t",
        target,
        "history-limit",
        String(HISTORY_LINES),
      ]),
    ]);
  }

  async attach(
    id: string,
    options: AttachTmuxOptions,
  ): Promise<AttachedTmuxClient> {
    const size = options.size ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
    await this.ensureSession(id, size);
    let closed = false;
    let paused = false;
    let exitReported = false;
    const reportExit = () => {
      if (exitReported) return;
      exitReported = true;
      options.onExit();
    };
    const terminal = spawnPty(
      this.tmuxBinary,
      ["-L", this.socketName, "attach-session", "-t", this.target(id)],
      {
        cwd: this.cwd,
        env: this.env,
        cols: size.cols,
        rows: size.rows,
        name: "xterm-256color",
      },
    );
    const dataSubscription = terminal.onData((data) =>
      options.onData(encoder.encode(data)),
    );
    const exitSubscription = terminal.onExit(reportExit);

    return {
      close() {
        if (closed) return;
        closed = true;
        if (paused) signalProcess(terminal.pid, "SIGCONT");
        dataSubscription.dispose();
        exitSubscription.dispose();
        terminal.kill("SIGTERM");
      },
      pauseOutput() {
        if (closed || paused) return;
        paused = true;
        signalProcess(terminal.pid, "SIGSTOP");
      },
      resize(nextSize) {
        if (!closed) terminal.resize(nextSize.cols, nextSize.rows);
      },
      resumeOutput() {
        if (closed || !paused) return;
        paused = false;
        signalProcess(terminal.pid, "SIGCONT");
      },
      write(data) {
        if (!closed) {
          terminal.write(
            typeof data === "string" ? data : decoder.decode(data),
          );
        }
      },
    };
  }

  async list(): Promise<TerminalSession[]> {
    const output = await this.run(
      [
        "list-sessions",
        "-F",
        "#{session_name}|#{session_created}|#{session_activity}|#{session_attached}",
      ],
      { allowNoServer: true },
    );
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const [name, created, activity, attached] = line.split("|");
        if (
          !name?.startsWith(TERMINAL_SESSION_PREFIX) ||
          created === undefined ||
          activity === undefined ||
          attached === undefined
        ) {
          return [];
        }
        const id = name.slice(TERMINAL_SESSION_PREFIX.length);
        const parsedId = terminalSessionIdSchema.safeParse(id);
        const attachedClients = Number(attached);
        if (
          !parsedId.success ||
          !Number.isInteger(attachedClients) ||
          attachedClients < 0
        ) {
          return [];
        }
        return [
          {
            attachedClients,
            createdAt: isoFromUnixSeconds(created),
            id: parsedId.data,
            lastActivityAt: isoFromUnixSeconds(activity),
          },
        ];
      })
      .sort((left, right) =>
        right.lastActivityAt.localeCompare(left.lastActivityAt),
      );
  }

  async kill(id: string): Promise<void> {
    await this.run(["kill-session", "-t", this.target(id)]);
  }

  async reapIdle(idleSessionMs: number): Promise<string[]> {
    const sessions = await this.list();
    const cutoff = this.now() - idleSessionMs;
    const expired = sessions.filter(
      (session) =>
        session.attachedClients === 0 &&
        Date.parse(session.lastActivityAt) <= cutoff,
    );
    await Promise.all(expired.map((session) => this.kill(session.id)));
    return expired.map((session) => session.id);
  }

  async killServer(): Promise<void> {
    await this.run(["kill-server"], { allowNoServer: true });
  }
}
