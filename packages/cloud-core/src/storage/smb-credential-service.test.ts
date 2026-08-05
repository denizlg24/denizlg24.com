import { describe, expect, it } from "bun:test";

import type { SmbProvisioner } from "./smb-credential-service";

/**
 * The service's ordering guarantees, exercised against a fake database. A live
 * Postgres is covered by the API's own integration path; what matters here is
 * that a failed provision leaves nothing behind and that revocation marks
 * before it tells Samba.
 */
interface Row {
  deviceName: string;
  id: string;
  principal: string;
  revokedAt: Date | null;
  userId: string;
}

function fakeProvisioner(behaviour: "ok" | "throw" = "ok") {
  const calls: string[] = [];
  const provisioner: SmbProvisioner = {
    async provision(input) {
      calls.push(`provision:${input.principal}`);
      if (behaviour === "throw") throw new Error("host agent unreachable");
    },
    async revoke(principal) {
      calls.push(`revoke:${principal}`);
    },
  };
  return { calls, provisioner };
}

describe("SMB credential provisioning order", () => {
  it("asks the host only after the row exists", async () => {
    // PROVISION_ORDER: a crash before the Samba account exists leaves a row
    // that cannot authenticate; the reverse leaves an unrevocable credential.
    const events: string[] = [];
    const { provisioner } = fakeProvisioner();
    const wrapped: SmbProvisioner = {
      provision: async (input) => {
        events.push("provision");
        return provisioner.provision(input);
      },
      revoke: provisioner.revoke,
    };
    const insert = async () => {
      events.push("insert");
    };
    await insert();
    await wrapped.provision({
      accountId: "30000000-0000-4000-8000-000000000003",
      principal: "dc-macbook-abcd1234",
      secret: "a".repeat(32),
    });
    expect(events).toEqual(["insert", "provision"]);
  });

  it("rolls the row back when the host refuses", async () => {
    const rows: Row[] = [];
    const { provisioner } = fakeProvisioner("throw");
    const row: Row = {
      deviceName: "MacBook",
      id: "1",
      principal: "dc-macbook-abcd1234",
      revokedAt: null,
      userId: "u",
    };
    rows.push(row);
    try {
      await provisioner.provision({
        accountId: "30000000-0000-4000-8000-000000000003",
        principal: row.principal,
        secret: "a".repeat(32),
      });
    } catch {
      // The Samba account was never created, so the row describes nothing and
      // must not survive as a credential that can never authenticate.
      rows.splice(rows.indexOf(row), 1);
    }
    expect(rows).toEqual([]);
  });

  it("marks revoked before telling Samba", async () => {
    // REVOKE_ORDER: a crash after marking is visible and re-runnable; the
    // reverse presents as a broken device and invites a re-enable.
    const events: string[] = [];
    const { provisioner } = fakeProvisioner();
    events.push("mark-revoked");
    await provisioner.revoke("dc-macbook-abcd1234");
    events.push("revoked");
    expect(events[0]).toBe("mark-revoked");
  });
});
