import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createZipStream } from "./archive";

describe("store-only ZIP streaming", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("streams sequential entries with local and central directory records", async () => {
    root = await mkdtemp(join(tmpdir(), "cloud-archive-"));
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    await Promise.all([Bun.write(first, "first"), Bun.write(second, "second")]);
    const bytes = new Uint8Array(
      await new Response(
        createZipStream([
          {
            name: "folder/first.txt",
            diskPath: first,
            size: 5,
            modifiedAt: new Date("2026-01-01T00:00:00Z"),
          },
          {
            name: "second.txt",
            diskPath: second,
            size: 6,
            modifiedAt: new Date("2026-01-01T00:00:00Z"),
          },
        ]),
      ).arrayBuffer(),
    );
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(Buffer.from(bytes).includes(Buffer.from("folder/first.txt"))).toBe(
      true,
    );
    expect(Buffer.from(bytes).includes(Buffer.from("second.txt"))).toBe(true);
    expect(view.getUint32(bytes.byteLength - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.byteLength - 12, true)).toBe(2);
  });
});
