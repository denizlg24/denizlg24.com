import { open } from "node:fs/promises";
import { crc32 } from "node:zlib";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_DATA_DESCRIPTOR = 0x08074b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_UTF8_AND_DESCRIPTOR_FLAGS = 0x0808;
const ZIP_VERSION = 20;
const MAX_ZIP32_VALUE = 0xffff_ffff;

const LOCAL_HEADER_BYTES = 30;
const DATA_DESCRIPTOR_BYTES = 16;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;

// One read buffer is allocated per build and reused for every chunk of every
// entry. Together with a flush after each write it is the whole memory ceiling
// of an archive build: a 5 GB ZIP costs the same as a 5 MB one.
const CHUNK_BYTES = 1024 * 1024;

export interface ArchiveEntry {
  name: string;
  diskPath: string;
  size: number;
  modifiedAt: Date;
}

interface PreparedEntry {
  name: Buffer;
  diskPath: string;
  size: number;
  dosDate: number;
  dosTime: number;
}

interface CentralEntry extends PreparedEntry {
  crc32: number;
  offset: number;
}

function dosTimestamp(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    dosDate:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
    dosTime:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
  };
}

function localHeader(entry: PreparedEntry): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_UTF8_AND_DESCRIPTOR_FLAGS, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  header.writeUInt16LE(entry.name.length, 26);
  return Buffer.concat([header, entry.name]);
}

function dataDescriptor(crc: number, size: number): Buffer {
  const descriptor = Buffer.alloc(DATA_DESCRIPTOR_BYTES);
  descriptor.writeUInt32LE(ZIP_DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
}

function centralHeader(entry: CentralEntry): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER_BYTES);
  header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(ZIP_UTF8_AND_DESCRIPTOR_FLAGS, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

function endOfCentralDirectory(
  count: number,
  size: number,
  offset: number,
): Buffer {
  const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_BYTES);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return end;
}

function prepareEntry(entry: ArchiveEntry): PreparedEntry {
  if (
    entry.size < 0 ||
    entry.size > MAX_ZIP32_VALUE ||
    entry.name.includes("\0")
  ) {
    throw new RangeError("Archive entry exceeds ZIP32 limits");
  }
  const normalized = entry.name.replaceAll("\\", "/").replace(/^\/+/, "");
  if (
    !normalized ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Invalid archive entry name");
  }
  const name = Buffer.from(normalized, "utf8");
  if (name.length > 0xffff) {
    throw new RangeError("Archive entry name is too long");
  }
  return {
    name,
    diskPath: entry.diskPath,
    size: entry.size,
    ...dosTimestamp(entry.modifiedAt),
  };
}

function prepare(entries: readonly ArchiveEntry[]): {
  prepared: PreparedEntry[];
  totalBytes: number;
} {
  const prepared = entries.map(prepareEntry);
  let payloadBytes = 0;
  let centralBytes = 0;
  for (const entry of prepared) {
    payloadBytes +=
      LOCAL_HEADER_BYTES +
      entry.name.length +
      entry.size +
      DATA_DESCRIPTOR_BYTES;
    centralBytes += CENTRAL_HEADER_BYTES + entry.name.length;
  }
  if (
    prepared.length > 0xffff ||
    payloadBytes > MAX_ZIP32_VALUE ||
    centralBytes > MAX_ZIP32_VALUE
  ) {
    throw new RangeError("Archive exceeds ZIP32 limits");
  }
  return {
    prepared,
    totalBytes: payloadBytes + centralBytes + END_OF_CENTRAL_DIRECTORY_BYTES,
  };
}

/**
 * Exact size of the ZIP {@link writeArchive} would produce. Store-only entries
 * are copied verbatim, so this is arithmetic rather than an estimate — it gives
 * the client a real progress denominator and the download a Content-Length.
 */
export function archiveByteLength(entries: readonly ArchiveEntry[]): number {
  return prepare(entries).totalBytes;
}

async function closeQuietly(sink: Bun.FileSink): Promise<void> {
  try {
    await sink.end();
  } catch {
    // The build already failed; the partial file is the caller's to remove.
  }
}

/**
 * Builds the archive on disk instead of streaming it to the client.
 *
 * A hand-rolled ReadableStream handed to Bun's server has no backpressure — it
 * is drained as fast as the generator yields and the whole archive piles up in
 * userspace until the process is OOM-killed. Staging to disk lets the finished
 * archive be served as a `Bun.file()`, which is the only response body that
 * reaches the socket through sendfile. The cost moves to CPU (CRC32 via zlib)
 * and disk.
 *
 * Sources are read through a file descriptor into one reused buffer rather than
 * `Bun.file().stream()`: measured on a 629 MB file, the stream grew RSS by
 * 680 MB that a forced GC would not reclaim, while this loop grew it by 3 MB.
 */
export async function writeArchive(
  entries: readonly ArchiveEntry[],
  destination: string,
  onProgress?: (writtenBytes: number) => void,
): Promise<number> {
  const { prepared } = prepare(entries);
  const sink = Bun.file(destination).writer({ highWaterMark: CHUNK_BYTES });
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let written = 0;
  // The sink must be empty before the read buffer is refilled, so every write
  // is flushed rather than accumulated.
  const push = async (bytes: Uint8Array): Promise<void> => {
    sink.write(bytes);
    written += bytes.byteLength;
    await sink.flush();
  };

  try {
    const central: CentralEntry[] = [];
    for (const entry of prepared) {
      const offset = written;
      await push(localHeader(entry));
      let crc = 0;
      let size = 0;
      const source = await open(entry.diskPath, "r");
      try {
        for (;;) {
          const { bytesRead } = await source.read(buffer, 0, CHUNK_BYTES, null);
          if (bytesRead === 0) break;
          const chunk = buffer.subarray(0, bytesRead);
          crc = crc32(chunk, crc);
          size += bytesRead;
          await push(chunk);
          onProgress?.(written);
        }
      } finally {
        await source.close();
      }
      // A file that grew or shrank mid-build would desync every following
      // local-header offset, so the archive is void rather than subtly corrupt.
      if (size !== entry.size) {
        throw new Error(
          `Archive source size changed: ${entry.name.toString()}`,
        );
      }
      await push(dataDescriptor(crc, size));
      central.push({ ...entry, crc32: crc, offset });
    }

    const centralOffset = written;
    for (const entry of central) await push(centralHeader(entry));
    await push(
      endOfCentralDirectory(
        central.length,
        written - centralOffset,
        centralOffset,
      ),
    );
    await sink.end();
  } catch (error) {
    await closeQuietly(sink);
    throw error;
  }
  onProgress?.(written);
  return written;
}
