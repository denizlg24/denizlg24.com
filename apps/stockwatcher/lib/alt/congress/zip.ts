import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

/** Reads one named entry from a zip held in memory (stored or deflated). */
export function unzipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--)
    if (view.getUint32(i, true) === END_OF_CENTRAL) {
      end = i;
      break;
    }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(at, true) !== CENTRAL_ENTRY) return null;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entryName = decoder.decode(
      zip.subarray(at + 46, at + 46 + nameLength),
    );
    at += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (view.getUint32(local, true) !== LOCAL_HEADER) return null;
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + compressed);
    if (method === 0) return data;
    if (method === 8) return new Uint8Array(inflateRawSync(data));
    return null;
  }
  return null;
}
