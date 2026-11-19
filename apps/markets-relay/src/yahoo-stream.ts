import { type Quote, quoteSchema } from "@repo/markets/schemas";
import { z } from "zod";

export type UpstreamStatus = "connected" | "connecting" | "disconnected";

const upstreamMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected") }),
  z.object({ type: z.literal("quotes"), quotes: z.array(quoteSchema) }),
]);

export class YahooStream {
  private socket: WebSocket | undefined;
  private tickers: string[] = [];
  private state: UpstreamStatus = "disconnected";
  private retry: ReturnType<typeof setTimeout> | undefined;
  private delay = 1000;

  constructor(
    private readonly url: string,
    private readonly onQuotes: (quotes: Quote[]) => void,
    private readonly onStatus: (status: UpstreamStatus) => void,
  ) {}

  getStatus(): UpstreamStatus {
    return this.state;
  }

  setSubscriptions(tickers: string[]): void {
    if (
      this.tickers.length === tickers.length &&
      this.tickers.every((ticker, index) => ticker === tickers[index])
    )
      return;

    this.tickers = tickers;
    if (tickers.length === 0) {
      clearTimeout(this.retry);
      this.retry = undefined;
      const socket = this.socket;
      this.socket = undefined;
      socket?.close();
      this.delay = 1000;
      this.setStatus("disconnected");
      return;
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(this.tickers));
    } else if (!this.socket && !this.retry) {
      this.connect();
    }
  }

  private setStatus(status: UpstreamStatus) {
    if (this.state === status) return;
    this.state = status;
    this.onStatus(status);
  }

  private connect() {
    this.setStatus("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket === socket) socket.send(JSON.stringify(this.tickers));
    });
    socket.addEventListener("message", ({ data }) => {
      if (this.socket !== socket || typeof data !== "string") return;
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      const parsed = upstreamMessage.safeParse(payload);
      if (!parsed.success) return;
      if (parsed.data.type === "connected") {
        this.delay = 1000;
        this.setStatus("connected");
      } else {
        this.onQuotes(parsed.data.quotes);
      }
    });
    socket.addEventListener("error", () => socket.close());
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.setStatus("disconnected");
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.connect();
      }, this.delay);
      this.delay = Math.min(this.delay * 2, 30_000);
    });
  }
}
