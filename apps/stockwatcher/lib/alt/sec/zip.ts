export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
};

export type RangeFetch = (range: string) => Promise<Response>;

const TAIL_BYTES = 65_536;

/**
 * Reads one member of a remote zip with HTTP range requests, so a 100 MB
 * archive is never held in memory: the tail gives the central directory, and
 * a member is streamed through inflate. Zip64 archives are refused.
 */
export async function zipDirectory(
  fetchRange: RangeFetch,
): Promise<Map<string, ZipEntry>> {
  const tailResponse = await fetchRange(`bytes=-${TAIL_BYTES}`);
  const tail = new DataView(await tailResponse.arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("The archive has no central directory.");
  const count = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryOffset = tail.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff)
    throw new Error("Zip64 archives are not supported.");

  const range = tailResponse.headers.get("content-range");
  const total = Number(range?.split("/")[1]);
  const tailStart = Number.isFinite(total) ? total - tail.byteLength : 0;
  const directory =
    directoryOffset >= tailStart
      ? new DataView(
          tail.buffer,
          directoryOffset - tailStart,
          Math.min(
            directorySize,
            tail.byteLength - (directoryOffset - tailStart),
          ),
        )
      : new DataView(
          await (
            await fetchRange(
              `bytes=${directoryOffset}-${directoryOffset + directorySize - 1}`,
            )
          ).arrayBuffer(),
        );

  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  let cursor = 0;
  while (
    cursor + 46 <= directory.byteLength &&
    directory.getUint32(cursor, true) === 0x02014b50
  ) {
    const nameLength = directory.getUint16(cursor + 28, true);
    const extraLength = directory.getUint16(cursor + 30, true);
    const commentLength = directory.getUint16(cursor + 32, true);
    const name = decoder.decode(
      new Uint8Array(
        directory.buffer,
        directory.byteOffset + cursor + 46,
        nameLength,
      ),
    );
    entries.set(name, {
      name,
      method: directory.getUint16(cursor + 10, true),
      compressedSize: directory.getUint32(cursor + 20, true),
      offset: directory.getUint32(cursor + 42, true),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The member's decompressed bytes as a stream. */
export async function zipEntryStream(
  fetchRange: RangeFetch,
  entry: ZipEntry,
): Promise<ReadableStream<Uint8Array>> {
  const header = new DataView(
    await (
      await fetchRange(`bytes=${entry.offset}-${entry.offset + 29}`)
    ).arrayBuffer(),
  );
  if (header.getUint32(0, true) !== 0x04034b50)
    throw new Error("The archive entry header is malformed.");
  const start =
    entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const response = await fetchRange(
    `bytes=${start}-${start + entry.compressedSize - 1}`,
  );
  if (!response.body) throw new Error("The archive entry has no body.");
  if (entry.method === 0) return response.body;
  if (entry.method !== 8)
    throw new Error(`Unsupported zip compression method ${entry.method}.`);
  return response.body.pipeThrough(new DecompressionStream("deflate-raw"));
}

/** Decoded lines of a stream, without holding more than one chunk. */
export async function* streamLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let rest = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      let newline = rest.indexOf("\n");
      while (newline >= 0) {
        yield rest.slice(0, newline).replace(/\r$/, "");
        rest = rest.slice(newline + 1);
        newline = rest.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  rest += decoder.decode();
  if (rest) yield rest;
}
