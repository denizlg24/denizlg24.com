import "server-only";

import { posix } from "node:path";
import type { ILatexProject } from "@repo/schemas";

const UTF8_FLAG = 0x0800;
const CRC_TABLE = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (value >>> 8) ^ (CRC_TABLE[(value ^ byte) & 0xff] ?? 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function safeLatexArchivePath(path: string): string {
  if (!path || path.includes("\\") || path.startsWith("/")) {
    throw new Error("Invalid archive path");
  }
  const normalized = posix.normalize(path);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid archive path");
  }
  return normalized;
}

function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    day:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}

function localHeader(options: {
  name: Buffer;
  bytes: Buffer;
  crc: number;
  time: number;
  day: number;
}): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(options.time, 10);
  header.writeUInt16LE(options.day, 12);
  header.writeUInt32LE(options.crc, 14);
  header.writeUInt32LE(options.bytes.length, 18);
  header.writeUInt32LE(options.bytes.length, 22);
  header.writeUInt16LE(options.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, options.name, options.bytes]);
}

function centralHeader(options: {
  name: Buffer;
  bytes: Buffer;
  crc: number;
  time: number;
  day: number;
  offset: number;
  folder: boolean;
}): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(options.time, 12);
  header.writeUInt16LE(options.day, 14);
  header.writeUInt32LE(options.crc, 16);
  header.writeUInt32LE(options.bytes.length, 20);
  header.writeUInt32LE(options.bytes.length, 24);
  header.writeUInt16LE(options.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(options.folder ? 0x10 : 0, 38);
  header.writeUInt32LE(options.offset, 42);
  return Buffer.concat([header, options.name]);
}

export function buildLatexSourceZip(
  project: ILatexProject,
  modifiedAt = new Date(),
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const { time, day } = dosTime(modifiedAt);
  let offset = 0;

  for (const entry of project.entries) {
    const path = safeLatexArchivePath(entry.path);
    const archiveName = entry.kind === "folder" ? `${path}/` : path;
    const name = Buffer.from(archiveName, "utf8");
    const bytes =
      entry.kind === "folder"
        ? Buffer.alloc(0)
        : Buffer.from(
            entry.content,
            entry.encoding === "base64" ? "base64" : "utf8",
          );
    const crc = crc32(bytes);
    const local = localHeader({ name, bytes, crc, time, day });
    localParts.push(local);
    centralParts.push(
      centralHeader({
        name,
        bytes,
        crc,
        time,
        day,
        offset,
        folder: entry.kind === "folder",
      }),
    );
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(project.entries.length, 8);
  end.writeUInt16LE(project.entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
