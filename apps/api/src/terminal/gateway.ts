import { TerminalTicketService } from "@repo/cloud-core/terminal";
import {
  type TerminalSession,
  type TerminalTicketClaims,
  terminalSessionIdSchema,
  terminalSessionsResponseSchema,
} from "@repo/schemas/cloud";

const REQUEST_TIMEOUT_MS = 5_000;

export interface TerminalGatewayOptions {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  serverUrl: string;
  ticketSecret: string;
}

function parseServerUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("TERMINAL_SERVER_URL must use ws:// or wss://");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "TERMINAL_SERVER_URL must not contain credentials or query",
    );
  }
  return url;
}

export class TerminalGateway {
  readonly ticketService: TerminalTicketService;
  private readonly fetchImplementation: NonNullable<
    TerminalGatewayOptions["fetch"]
  >;
  private readonly serverUrl: URL;

  constructor(options: TerminalGatewayOptions) {
    this.serverUrl = parseServerUrl(options.serverUrl);
    this.ticketService = new TerminalTicketService(options.ticketSecret);
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async mint(subject: string, requestedSessionId?: string) {
    const sessionId = terminalSessionIdSchema.parse(
      requestedSessionId ?? crypto.randomUUID(),
    );
    const { claims, ticket } = await this.ticketService.mint({
      sessionId,
      subject,
    });
    return {
      expiresAt: new Date(claims.exp * 1_000).toISOString(),
      sessionId,
      ticket,
    };
  }

  verify(ticket: string): Promise<TerminalTicketClaims> {
    return this.ticketService.verify(ticket);
  }

  websocketUrl(ticket: string): string {
    const url = new URL("/ws", this.serverUrl);
    url.searchParams.set("ticket", ticket);
    return url.toString();
  }

  private async request(
    subject: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const { ticket } = await this.ticketService.mint({ subject });
    const url = new URL(path, this.serverUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    const response = await this.fetchImplementation(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${ticket}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response;
  }

  async listSessions(subject: string): Promise<TerminalSession[]> {
    const response = await this.request(subject, "/sessions");
    if (!response.ok) {
      throw new Error(`Terminal service returned ${response.status}`);
    }
    return terminalSessionsResponseSchema.parse(await response.json()).data;
  }

  async killSession(subject: string, id: string): Promise<boolean> {
    const sessionId = terminalSessionIdSchema.parse(id);
    const response = await this.request(
      subject,
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(`Terminal service returned ${response.status}`);
    }
    return true;
  }
}
