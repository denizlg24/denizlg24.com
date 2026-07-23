const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_DATA_DESCRIPTOR = 0x08074b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_UTF8_AND_DESCRIPTOR_FLAGS = 0x0808;
const ZIP_VERSION = 20;
const MAX_ZIP32_VALUE = 0xffff_ffff;

export interface ArchiveEntry {
  name: string;
  diskPath: string;
  size: number;
  modifiedAt: Date;
}

interface CentralEntry {
  name: Buffer;
  crc32: number;
  size: number;
  offset: number;
  dosDate: number;
  dosTime: number;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes) {
    const lookup = CRC_TABLE[(value ^ byte) & 0xff];
    if (lookup === undefined) {
      throw new Error("CRC lookup failed");
    }
    value = lookup ^ (value >>> 8);
  }
  return value >>> 0;
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

function localHeader(name: Buffer, dosDate: number, dosTime: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_UTF8_AND_DESCRIPTOR_FLAGS, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name]);
}

function dataDescriptor(crc32: number, size: number): Buffer {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(ZIP_DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(crc32, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
}

function centralHeader(entry: CentralEntry): Buffer {
  const header = Buffer.alloc(46);
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
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return end;
}

function validateEntry(entry: ArchiveEntry): Buffer {
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
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Invalid archive entry name");
  }
  const name = Buffer.from(normalized, "utf8");
  if (name.length > 0xffff) {
    throw new RangeError("Archive entry name is too long");
  }
  return name;
}

async function* zipGenerator(
  entries: readonly ArchiveEntry[],
): AsyncGenerator<Uint8Array> {
  const centralEntries: CentralEntry[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = validateEntry(entry);
    const { dosDate, dosTime } = dosTimestamp(entry.modifiedAt);
    const header = localHeader(name, dosDate, dosTime);
    const localOffset = offset;
    offset += header.byteLength;
    yield header;

    let crc = 0xffff_ffff;
    let actualSize = 0;
    const reader = Bun.file(entry.diskPath).stream().getReader();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      actualSize += chunk.byteLength;
      crc = updateCrc32(crc, chunk);
      offset += chunk.byteLength;
      yield chunk;
    }
    if (actualSize !== entry.size) {
      throw new Error(`Archive source size changed: ${entry.name}`);
    }
    const finalCrc = (crc ^ 0xffff_ffff) >>> 0;
    const descriptor = dataDescriptor(finalCrc, actualSize);
    offset += descriptor.byteLength;
    yield descriptor;
    centralEntries.push({
      name,
      crc32: finalCrc,
      size: actualSize,
      offset: localOffset,
      dosDate,
      dosTime,
    });
  }

  const centralOffset = offset;
  for (const entry of centralEntries) {
    const header = centralHeader(entry);
    offset += header.byteLength;
    yield header;
  }
  const centralSize = offset - centralOffset;
  if (
    centralEntries.length > 0xffff ||
    centralOffset > MAX_ZIP32_VALUE ||
    centralSize > MAX_ZIP32_VALUE
  ) {
    throw new RangeError("Archive exceeds ZIP32 limits");
  }
  yield endOfCentralDirectory(
    centralEntries.length,
    centralSize,
    centralOffset,
  );
}

export function createZipStream(
  entries: readonly ArchiveEntry[],
): ReadableStream<Uint8Array> {
  const iterator = zipGenerator(entries);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
