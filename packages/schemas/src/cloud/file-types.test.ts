import { describe, expect, it } from "bun:test";

import {
  fileExtension,
  looksBinary,
  mimeTypeForFilename,
  parseDelimited,
} from "./file-types";

describe("fileExtension", () => {
  it("reads the last extension, lowercased", () => {
    expect(fileExtension("Holiday.JPG")).toBe("jpg");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });

  it("treats a dotfile as having no extension", () => {
    expect(fileExtension(".gitignore")).toBe("");
    expect(fileExtension("Makefile")).toBe("");
  });

  it("ignores dots in parent directories", () => {
    expect(fileExtension("v1.2/notes")).toBe("");
  });
});

describe("mimeTypeForFilename", () => {
  it("resolves the media a broker-mounted namespace carries no xattr for", () => {
    expect(mimeTypeForFilename("clip.MOV")).toBe("video/quicktime");
    expect(mimeTypeForFilename("scan.jpeg")).toBe("image/jpeg");
    expect(mimeTypeForFilename("track.mp3")).toBe("audio/mpeg");
    expect(mimeTypeForFilename("report.pdf")).toBe("application/pdf");
  });

  it("keeps active content identifiable so it is still forced to download", () => {
    expect(mimeTypeForFilename("logo.svg")).toBe("image/svg+xml");
    expect(mimeTypeForFilename("page.html")).toBe("text/html");
  });

  it("answers null when the name says nothing", () => {
    expect(mimeTypeForFilename("library.pfl")).toBeNull();
    expect(mimeTypeForFilename("dump")).toBeNull();
  });

  it("recognises extensionless text by name", () => {
    expect(mimeTypeForFilename("Dockerfile")).toBe("text/plain");
    expect(mimeTypeForFilename(".env")).toBe("text/plain");
  });
});

describe("parseDelimited", () => {
  it("splits rows and fields", () => {
    expect(parseDelimited("a,b\n1,2\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a delimiter that sits inside quotes", () => {
    expect(parseDelimited('name,city\n"Doe, J",Porto', ",")).toEqual([
      ["name", "city"],
      ["Doe, J", "Porto"],
    ]);
  });

  it("keeps a newline that sits inside quotes", () => {
    // The case a split("\n") gets wrong, and the one that shifts every later
    // column by one.
    expect(parseDelimited('a,b\n"one\ntwo",3', ",")).toEqual([
      ["a", "b"],
      ["one\ntwo", "3"],
    ]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseDelimited('a\n"say ""hi"""', ",")).toEqual([
      ["a"],
      ['say "hi"'],
    ]);
  });

  it("handles CRLF and tabs", () => {
    expect(parseDelimited("a\tb\r\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not invent a trailing row", () => {
    expect(parseDelimited("a,b\n", ",")).toEqual([["a", "b"]]);
    expect(parseDelimited("", ",")).toEqual([]);
  });
});

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("looksBinary", () => {
  it("passes ordinary text", () => {
    expect(looksBinary(bytesOf("hello\nworld\t2026\r\n"), false)).toBe(false);
    expect(looksBinary(bytesOf("acentuação — ok ✓"), false)).toBe(false);
  });

  it("treats an empty slice as text rather than refusing it", () => {
    expect(looksBinary(new Uint8Array(0), false)).toBe(false);
  });

  it("rejects anything holding a NUL", () => {
    expect(looksBinary(new Uint8Array([0x68, 0x69, 0x00, 0x68]), false)).toBe(
      true,
    );
  });

  it("rejects a slice thick with control bytes", () => {
    const bytes = new Uint8Array(256);
    for (let index = 0; index < bytes.length; index += 1) {
      // No NUL, so the control-byte ratio is what has to catch this.
      bytes[index] = (index % 0x1f) + 1;
    }
    expect(looksBinary(bytes, false)).toBe(true);
  });

  it("rejects bytes that do not decode as UTF-8", () => {
    const bytes = new Uint8Array(512);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = 0x80 + (index % 0x40);
    }
    expect(looksBinary(bytes, false)).toBe(true);
  });

  it("tolerates a multi-byte character cut by the range boundary", () => {
    const text = bytesOf(`${"a".repeat(64)}é`);
    const cut = text.subarray(0, text.length - 1);
    expect(looksBinary(cut, true)).toBe(false);
    // Why the flag exists: read as a complete file, the same slice is damaged.
    expect(looksBinary(cut, false)).toBe(true);
  });

  it("tolerates one mojibake byte in a long log", () => {
    const bytes = bytesOf(`${"log line\n".repeat(200)}x`);
    bytes[bytes.length - 1] = 0xff;
    expect(looksBinary(bytes, false)).toBe(false);
  });
});
