import {
  TERMINAL_TICKET_AUDIENCE,
  TERMINAL_TICKET_TTL_SECONDS,
  type TerminalTicketClaims,
  terminalTicketClaimsSchema,
} from "@repo/schemas/cloud";

const TICKET_VERSION = "v1";
const MAX_TICKET_LENGTH = 2_048;
const encoder = new TextEncoder();

export type TerminalTicketErrorCode =
  | "TICKET_EXPIRED"
  | "TICKET_INVALID"
  | "TICKET_REPLAYED";

export class TerminalTicketError extends Error {
  constructor(
    message: string,
    readonly code: TerminalTicketErrorCode,
  ) {
    super(message);
    this.name = "TerminalTicketError";
  }
}

export interface MintTerminalTicketOptions {
  sessionId?: string;
  subject: string;
}

export interface TerminalTicketServiceOptions {
  now?: () => number;
  randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
}

function encodeBase64Url(value: Uint8Array | string): string {
  return Buffer.from(
    typeof value === "string" ? encoder.encode(value) : value,
  ).toString("base64url");
}

function decodePayload(value: string): object {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    const parsed: object = JSON.parse(json);
    return parsed;
  } catch {
    throw new TerminalTicketError("Invalid terminal ticket", "TICKET_INVALID");
  }
}

export class TerminalTicketReplayGuard {
  private readonly used = new Map<string, number>();

  consume(claims: TerminalTicketClaims, nowSeconds: number): void {
    for (const [jti, expiresAt] of this.used) {
      if (expiresAt <= nowSeconds) this.used.delete(jti);
    }
    if (this.used.has(claims.jti)) {
      throw new TerminalTicketError(
        "Terminal ticket was already used",
        "TICKET_REPLAYED",
      );
    }
    this.used.set(claims.jti, claims.exp);
  }
}

export class TerminalTicketService {
  private readonly key: Promise<CryptoKey>;
  private readonly now: () => number;
  private readonly randomUUID: () => ReturnType<typeof crypto.randomUUID>;

  constructor(secret: string, options: TerminalTicketServiceOptions = {}) {
    if (encoder.encode(secret).byteLength < 32) {
      throw new Error("TERMINAL_TICKET_SECRET must be at least 32 bytes");
    }
    this.key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign", "verify"],
    );
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  }

  async mint(options: MintTerminalTicketOptions): Promise<{
    claims: TerminalTicketClaims;
    ticket: string;
  }> {
    const issuedAt = Math.floor(this.now() / 1_000);
    const claims = terminalTicketClaimsSchema.parse({
      aud: TERMINAL_TICKET_AUDIENCE,
      exp: issuedAt + TERMINAL_TICKET_TTL_SECONDS,
      iat: issuedAt,
      jti: this.randomUUID(),
      sid: options.sessionId,
      sub: options.subject,
    });
    const payload = encodeBase64Url(JSON.stringify(claims));
    const signed = `${TICKET_VERSION}.${payload}`;
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", await this.key, encoder.encode(signed)),
    );
    return {
      claims,
      ticket: `${signed}.${encodeBase64Url(signature)}`,
    };
  }

  async verify(
    ticket: string,
    replayGuard?: TerminalTicketReplayGuard,
  ): Promise<TerminalTicketClaims> {
    if (ticket.length > MAX_TICKET_LENGTH) {
      throw new TerminalTicketError(
        "Invalid terminal ticket",
        "TICKET_INVALID",
      );
    }
    const parts = ticket.split(".");
    if (
      parts.length !== 3 ||
      parts[0] !== TICKET_VERSION ||
      !parts[1] ||
      !parts[2]
    ) {
      throw new TerminalTicketError(
        "Invalid terminal ticket",
        "TICKET_INVALID",
      );
    }
    const [version, payload, encodedSignature] = parts;
    const signature = Buffer.from(encodedSignature, "base64url");
    if (
      signature.byteLength !== 32 ||
      encodeBase64Url(signature) !== encodedSignature
    ) {
      throw new TerminalTicketError(
        "Invalid terminal ticket",
        "TICKET_INVALID",
      );
    }
    const valid = await crypto.subtle.verify(
      "HMAC",
      await this.key,
      signature,
      encoder.encode(`${version}.${payload}`),
    );
    if (!valid) {
      throw new TerminalTicketError(
        "Invalid terminal ticket",
        "TICKET_INVALID",
      );
    }
    const parsed = terminalTicketClaimsSchema.safeParse(decodePayload(payload));
    if (!parsed.success) {
      throw new TerminalTicketError(
        "Invalid terminal ticket",
        "TICKET_INVALID",
      );
    }
    const nowSeconds = Math.floor(this.now() / 1_000);
    if (
      parsed.data.iat > nowSeconds + 5 ||
      parsed.data.exp - parsed.data.iat !== TERMINAL_TICKET_TTL_SECONDS
    ) {
      throw new TerminalTicketError(
        "Invalid terminal ticket",
        "TICKET_INVALID",
      );
    }
    if (parsed.data.exp <= nowSeconds) {
      throw new TerminalTicketError(
        "Terminal ticket expired",
        "TICKET_EXPIRED",
      );
    }
    replayGuard?.consume(parsed.data, nowSeconds);
    return parsed.data;
  }
}
