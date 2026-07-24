import { describe, expect, it } from "bun:test";
import {
  TerminalTicketReplayGuard,
  TerminalTicketService,
} from "@repo/cloud-core/terminal";

import { TerminalGateway } from "./gateway";

const SECRET = "terminal-gateway-test-secret-at-least-32-bytes";

describe("terminal gateway", () => {
  it("mints browser tickets and uses fresh one-use service tickets", async () => {
    const verifier = new TerminalTicketService(SECRET);
    const replayGuard = new TerminalTicketReplayGuard();
    let seenSubject = "";
    const gateway = new TerminalGateway({
      serverUrl: "ws://127.0.0.1:3003",
      ticketSecret: SECRET,
      fetch: async (_input, init) => {
        const authorization = new Headers(init?.headers).get("Authorization");
        const ticket = authorization?.slice("Bearer ".length) ?? "";
        seenSubject = (await verifier.verify(ticket, replayGuard)).sub;
        return Response.json({
          data: [
            {
              attachedClients: 0,
              createdAt: "2026-07-24T12:00:00.000Z",
              id: "maintenance",
              lastActivityAt: "2026-07-24T12:01:00.000Z",
            },
          ],
        });
      },
    });

    const minted = await gateway.mint("operator");
    expect((await gateway.verify(minted.ticket)).sid).toBe(minted.sessionId);
    expect(
      (await gateway.listSessions("operator")).map(({ id }) => id),
    ).toEqual(["maintenance"]);
    expect(seenSubject).toBe("operator");
  });

  it("rejects session IDs outside the subject namespace", async () => {
    const gateway = new TerminalGateway({
      serverUrl: "ws://127.0.0.1:3003",
      ticketSecret: SECRET,
    });
    const { sessionId } = await gateway.mint("operator-a");

    await expect(gateway.mint("operator-b", sessionId)).rejects.toThrow(
      "not owned",
    );
  });

  it("rejects non-WebSocket terminal targets", () => {
    expect(
      () =>
        new TerminalGateway({
          serverUrl: "https://example.test",
          ticketSecret: SECRET,
        }),
    ).toThrow("ws:// or wss://");
  });
});
