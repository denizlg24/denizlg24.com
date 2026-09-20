import { type Browser, type BrowserContext, chromium } from "playwright";

export interface BrowserPoolOptions {
  proxyServer: string;
  viewport: { width: number; height: number };
  /** Contexts kept at once; the least recently used is closed for a new one. */
  maxSessions: number;
  /** A context untouched for this long is closed. */
  sessionIdleMs: number;
  executablePath?: string;
  onError?: (error: unknown) => void;
}

interface Session {
  context: Promise<BrowserContext>;
  lastUsedAt: number;
}

/**
 * One Chromium, one context per agent session. The key is whatever the
 * caller says it is (a conversation, a run, a bare MCP session); the context
 * outlives the MCP session that opened it, which is what lets the next turn
 * of a conversation find its tabs where the last one left them.
 */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;
  private readonly sessions = new Map<string, Session>();
  private reaper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: BrowserPoolOptions) {}

  start(): void {
    this.reaper ??= setInterval(
      () => void this.reapIdle(),
      Math.min(this.options.sessionIdleMs, 60_000),
    );
  }

  private async launch(): Promise<Browser> {
    const browser = await chromium.launch({
      headless: true,
      ...(this.options.executablePath
        ? { executablePath: this.options.executablePath }
        : {}),
      // `<-loopback>` removes Chromium's implicit proxy bypass for localhost,
      // so even 127.0.0.1 is decided by the proxy.
      proxy: { server: this.options.proxyServer, bypass: "<-loopback>" },
      args: ["--disable-dev-shm-usage"],
      // Shutdown closes contexts, then the browser; Playwright's own signal
      // handlers would kill Chromium under the contexts being closed.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    browser.once("disconnected", () => {
      this.browser = null;
      this.sessions.clear();
    });
    return browser;
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = this.launch().catch((error: unknown) => {
        this.browser = null;
        throw error;
      });
    }
    return this.browser;
  }

  async connected(): Promise<boolean> {
    if (!this.browser) return false;
    const browser = await this.browser.catch(() => null);
    return browser?.isConnected() ?? false;
  }

  get size(): number {
    return this.sessions.size;
  }

  keys(): string[] {
    return [...this.sessions.keys()];
  }

  touch(key: string): void {
    const session = this.sessions.get(key);
    if (session) session.lastUsedAt = Date.now();
  }

  async acquire(key: string): Promise<BrowserContext> {
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      const context = await existing.context;
      if (context.browser()?.isConnected()) return context;
      this.sessions.delete(key);
    }
    while (this.sessions.size >= this.options.maxSessions) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
      )[0];
      if (!oldest) break;
      await this.release(oldest[0]);
    }
    const session: Session = {
      context: this.getBrowser().then((browser) =>
        browser.newContext({ viewport: this.options.viewport }),
      ),
      lastUsedAt: Date.now(),
    };
    this.sessions.set(key, session);
    try {
      const context = await session.context;
      context.once("close", () => {
        if (this.sessions.get(key) === session) this.sessions.delete(key);
      });
      return context;
    } catch (error) {
      this.sessions.delete(key);
      throw error;
    }
  }

  async release(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    const context = await session.context.catch(() => null);
    await context
      ?.close()
      .catch((error: unknown) => this.options.onError?.(error));
  }

  async reapIdle(now = Date.now()): Promise<string[]> {
    const reaped: string[] = [];
    for (const [key, session] of this.sessions) {
      if (now - session.lastUsedAt < this.options.sessionIdleMs) continue;
      await this.release(key);
      reaped.push(key);
    }
    return reaped;
  }

  async close(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
    for (const key of this.keys()) await this.release(key);
    const browser = await this.browser?.catch(() => null);
    this.browser = null;
    await browser?.close().catch(() => {});
  }
}
