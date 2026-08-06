import { describe, expect, it } from "bun:test";

import { parseSmbAuditLine, RecentWriterIndex } from "./smb-audit";

const ROOT = "/srv/deniz-cloud/storage";

describe("parseSmbAuditLine", () => {
  it("reads the principal and path off a creating create_file", () => {
    const event = parseSmbAuditLine(
      "dc-deniz-machin-fc0baf2c|100.108.153.46|Shared|create_file|ok|0x80|file|open_if|/srv/deniz-cloud/storage/shared/report.pdf",
    );

    expect(event).toEqual({
      absolutePath: "/srv/deniz-cloud/storage/shared/report.pdf",
      operation: "create_file",
      principal: "dc-deniz-machin-fc0baf2c",
      share: "Shared",
    });
  });

  it("ignores create_file that merely opened an existing entry", () => {
    // Captured verbatim from the Pi: browsing the share emits exactly this, and
    // treating it as authorship would credit the file to whoever last read it.
    expect(
      parseSmbAuditLine(
        "dc-deniz-machin-fc0baf2c|100.108.153.46|Shared|create_file|ok|0x80|file|open|/srv/deniz-cloud/storage/shared",
      ),
    ).toBeNull();
  });

  it("accepts every disposition that brings an entry into existence", () => {
    for (const disposition of [
      "create",
      "open_if",
      "overwrite",
      "overwrite_if",
      "supersede",
    ]) {
      const event = parseSmbAuditLine(
        `dc-x-1|1.2.3.4|Shared|create_file|ok|0x80|file|${disposition}|/srv/deniz-cloud/storage/shared/a.pdf`,
      );
      expect(event?.principal).toBe("dc-x-1");
    }
  });

  it("strips a syslog prefix", () => {
    const event = parseSmbAuditLine(
      "2026-08-06T01:44:42.63+01:00 pi-cloud smbd_audit: dc-x-1|1.2.3.4|Shared|mkdirat|ok|/srv/deniz-cloud/storage/shared/new",
    );

    expect(event?.principal).toBe("dc-x-1");
    expect(event?.absolutePath).toBe("/srv/deniz-cloud/storage/shared/new");
  });

  it("credits a rename to its destination", () => {
    // The last field is the destination, which is the path a move-in creates.
    const event = parseSmbAuditLine(
      "dc-x-1|1.2.3.4|Shared|renameat|ok|/srv/deniz-cloud/storage/shared/old.pdf|/srv/deniz-cloud/storage/shared/new.pdf",
    );

    expect(event?.absolutePath).toBe("/srv/deniz-cloud/storage/shared/new.pdf");
  });

  it("ignores reads, failures, the broker share and unknown lines", () => {
    const lines = [
      "dc-x-1|1.2.3.4|Shared|openat|ok|r|/srv/deniz-cloud/storage/shared/a.pdf",
      "dc-x-1|1.2.3.4|Shared|renameat|fail|/srv/a|/srv/deniz-cloud/storage/b",
      "api-broker|127.0.0.1|ApiBroker|create_file|ok|0x80|file|create|/srv/deniz-cloud/storage/a.pdf",
      "dc-x-1|1.2.3.4|Shared|close|ok|/srv/deniz-cloud/storage/shared/a.pdf",
      "not an audit line at all",
    ];

    for (const line of lines) expect(parseSmbAuditLine(line)).toBeNull();
  });
});

describe("RecentWriterIndex", () => {
  const event = (path: string, principal: string) => ({
    absolutePath: `${ROOT}/${path}`,
    operation: "create_file",
    principal,
    share: "Shared",
  });

  it("returns the most recent writer of a path", () => {
    const index = new RecentWriterIndex({ namespaceRoot: ROOT });
    index.record(event("shared/a.pdf", "dc-old"), 1_000);
    index.record(event("shared/a.pdf", "dc-new"), 2_000);

    expect(index.writerOf("shared/a.pdf", 3_000)?.principal).toBe("dc-new");
  });

  it("ignores paths outside the namespace", () => {
    const index = new RecentWriterIndex({ namespaceRoot: ROOT });
    index.record(
      {
        absolutePath: "/etc/passwd",
        operation: "create_file",
        principal: "dc-x",
        share: "Shared",
      },
      1_000,
    );

    expect(index.size).toBe(0);
  });

  it("forgets a writer past the TTL rather than reporting a stale one", () => {
    const index = new RecentWriterIndex({ namespaceRoot: ROOT, ttlMs: 1_000 });
    index.record(event("shared/a.pdf", "dc-x"), 1_000);

    expect(index.writerOf("shared/a.pdf", 1_500)?.principal).toBe("dc-x");
    // A miss must read as "unknown" so adoption falls back rather than guessing.
    expect(index.writerOf("shared/a.pdf", 5_000)).toBeNull();
  });

  it("stays bounded under a bulk copy, evicting oldest first", () => {
    const index = new RecentWriterIndex({ maxEntries: 3, namespaceRoot: ROOT });
    for (let n = 0; n < 10; n += 1) {
      index.record(event(`shared/file-${n}.pdf`, "dc-x"), 1_000 + n);
    }

    expect(index.size).toBe(3);
    expect(index.writerOf("shared/file-0.pdf", 1_010)).toBeNull();
    expect(index.writerOf("shared/file-9.pdf", 1_010)?.principal).toBe("dc-x");
  });
});
