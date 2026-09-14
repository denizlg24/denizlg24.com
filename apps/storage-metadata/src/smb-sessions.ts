import {
  type OpenSmbSession,
  parseSmbstatusBrief,
  type SmbSessionsPayload,
} from "@repo/cloud-core";

import type { SmbAuditTail } from "./audit-tail";

export interface SmbSessionsOptions {
  auditTail: Pick<SmbAuditTail, "connections">;
  /** Overridable so the unit is testable without Samba. */
  smbstatus?: () => Promise<string>;
  timeoutMs?: number;
}

/**
 * `smbstatus -b`, bounded.
 *
 * Reads the session table out of Samba's own tdb, so it runs as root here
 * where the API cannot. It is a status column for a page a person is looking
 * at, so a hung or missing `smbstatus` is answered with "no open sessions",
 * never an error: the audit stream still says who connected and when.
 */
async function runSmbstatus(timeoutMs: number): Promise<string> {
  const process = Bun.spawn(["smbstatus", "-b"], {
    stderr: "ignore",
    stdout: "pipe",
  });
  const timer = setTimeout(() => process.kill(), timeoutMs);
  try {
    return await new Response(process.stdout).text();
  } finally {
    clearTimeout(timer);
  }
}

export async function readSmbSessions(
  options: SmbSessionsOptions,
): Promise<SmbSessionsPayload> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const read = options.smbstatus ?? (() => runSmbstatus(timeoutMs));
  let open: OpenSmbSession[] = [];
  try {
    open = parseSmbstatusBrief(await read());
  } catch {
    // Missing binary, killed on timeout, or unreadable output: all of them
    // mean "unknown", and the connections list below stands on its own.
  }
  return { connections: options.auditTail.connections(), open };
}
