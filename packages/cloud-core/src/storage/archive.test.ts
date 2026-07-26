import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import { type ArchiveEntry, archiveByteLength, writeArchive } from "./archive";

describe("store-only ZIP building", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function fixture(): Promise<{
    entries: ArchiveEntry[];
    destination: string;
  }> {
    root = await mkdtemp(join(tmpdir(), "cloud-archive-"));
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    await Promise.all([Bun.write(first, "first"), Bun.write(second, "second")]);
    const modifiedAt = new Date("2026-01-01T00:00:00Z");
    return {
      destination: join(root, "out.zip"),
      entries: [
        { name: "folder/first.txt", diskPath: first, size: 5, modifiedAt },
        { name: "second.txt", diskPath: second, size: 6, modifiedAt },
      ],
    };
  }

  it("writes local and central directory records", async () => {
    const { entries, destination } = await fixture();
    await writeArchive(entries, destination);
    const bytes = new Uint8Array(await Bun.file(destination).arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(Buffer.from(bytes).includes(Buffer.from("folder/first.txt"))).toBe(
      true,
    );
    expect(Buffer.from(bytes).includes(Buffer.from("second.txt"))).toBe(true);
    expect(view.getUint32(bytes.byteLength - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.byteLength - 12, true)).toBe(2);
  });

  // The client's progress bar and the download's Content-Length both come from
  // the predicted size, so it has to be the size, not an estimate.
  it("predicts the output size exactly", async () => {
    const { entries, destination } = await fixture();
    const predicted = archiveByteLength(entries);
    const written = await writeArchive(entries, destination);
    expect(written).toBe(predicted);
    expect(Bun.file(destination).size).toBe(predicted);
  });

  it("records each entry's CRC32 in its data descriptor", async () => {
    const { entries, destination } = await fixture();
    await writeArchive(entries, destination);
    const bytes = Buffer.from(await Bun.file(destination).arrayBuffer());
    // 30-byte local header + name + 5 bytes of "first", then the descriptor.
    const descriptor = 30 + "folder/first.txt".length + 5;
    expect(bytes.readUInt32LE(descriptor)).toBe(0x08074b50);
    expect(bytes.readUInt32LE(descriptor + 4)).toBe(
      crc32(Buffer.from("first")),
    );
    expect(bytes.readUInt32LE(descriptor + 8)).toBe(5);
  });

  it("reports progress as it writes", async () => {
    const { entries, destination } = await fixture();
    const seen: number[] = [];
    const written = await writeArchive(entries, destination, (bytes) =>
      seen.push(bytes),
    );
    expect(seen.at(-1)).toBe(written);
  });

  it("rejects entry names that escape the archive root", async () => {
    const { entries, destination } = await fixture();
    const escaping = entries.map((entry) => ({
      ...entry,
      name: `../${entry.name}`,
    }));
    expect(() => archiveByteLength(escaping)).toThrow("Invalid archive entry");
    await expect(writeArchive(escaping, destination)).rejects.toThrow(
      "Invalid archive entry",
    );
  });

  it("fails when a source file changed size since it was listed", async () => {
    const { entries, destination } = await fixture();
    const stale = entries.map((entry) => ({ ...entry, size: entry.size + 1 }));
    await expect(writeArchive(stale, destination)).rejects.toThrow(
      "Archive source size changed",
    );
  });
});
