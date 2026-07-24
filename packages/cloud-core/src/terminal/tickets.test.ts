import { describe, expect, it } from "bun:test";

import {
  TerminalTicketError,
  TerminalTicketReplayGuard,
  TerminalTicketService,
} from "./tickets";

const SECRET = "terminal-test-secret-with-at-least-32-bytes";
const JTI = "4fb5fc40-15c2-4b8f-9123-31a739ef6974";

describe("terminal tickets", () => {
  it("mints and verifies the fixed 30-second lifecycle", async () => {
    let now = Date.parse("2026-07-24T12:00:00.000Z");
    const service = new TerminalTicketService(SECRET, {
      now: () => now,
      randomUUID: () => JTI,
    });
    const minted = await service.mint({
      sessionId: "maintenance",
      subject: "operator",
    });

    expect((await service.verify(minted.ticket)).sid).toBe("maintenance");
    now += 29_000;
    expect((await service.verify(minted.ticket)).sub).toBe("operator");
    now += 1_000;
    await expect(service.verify(minted.ticket)).rejects.toMatchObject({
      code: "TICKET_EXPIRED",
    });
  });

  it("rejects tampering and short secrets", async () => {
    expect(() => new TerminalTicketService("too-short")).toThrow(
      "at least 32 bytes",
    );
    const service = new TerminalTicketService(SECRET, {
      randomUUID: () => JTI,
    });
    const { ticket } = await service.mint({ subject: "operator" });
    const tampered = `${ticket.slice(0, -1)}${ticket.endsWith("a") ? "b" : "a"}`;

    await expect(service.verify(tampered)).rejects.toBeInstanceOf(
      TerminalTicketError,
    );
  });

  it("consumes a jti once on the terminal side", async () => {
    const service = new TerminalTicketService(SECRET, {
      randomUUID: () => JTI,
    });
    const guard = new TerminalTicketReplayGuard();
    const { ticket } = await service.mint({ subject: "operator" });

    await service.verify(ticket, guard);
    await expect(service.verify(ticket, guard)).rejects.toMatchObject({
      code: "TICKET_REPLAYED",
    });
  });
});
