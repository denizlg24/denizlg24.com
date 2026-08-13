/**
 * Content types derived from a filename.
 *
 * Broker-mounted storage keeps the declared MIME type in a protected xattr, and
 * only a file uploaded through the API ever carries one — anything written over
 * SMB arrives with none, which is the majority of the namespace. The stored
 * `mimeType` is therefore null far more often than not, and both sides of the
 * wire need the same answer for those: the API to declare a Content-Type the
 * browser will render under `nosniff`, and a client to decide what it can
 * preview. One table, consulted from both, keeps them from disagreeing.
 *
 * The name is weaker evidence than a declared type, so it is only ever a
 * fallback. It is still far better than `application/octet-stream`, which with
 * `nosniff` makes every image, clip and PDF in the namespace unviewable.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  "7z": "application/x-7z-compressed",
  aac: "audio/aac",
  apk: "application/vnd.android.package-archive",
  avi: "video/x-msvideo",
  avif: "image/avif",
  bmp: "image/bmp",
  bz2: "application/x-bzip2",
  c: "text/x-c",
  cc: "text/x-c++",
  cjs: "text/javascript",
  conf: "text/plain",
  cpp: "text/x-c++",
  cs: "text/x-csharp",
  css: "text/css",
  csv: "text/csv",
  dmg: "application/x-apple-diskimage",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  eml: "message/rfc822",
  eot: "application/vnd.ms-fontobject",
  epub: "application/epub+zip",
  exe: "application/vnd.microsoft.portable-executable",
  flac: "audio/flac",
  flv: "video/x-flv",
  go: "text/x-go",
  gz: "application/gzip",
  gif: "image/gif",
  h: "text/x-c",
  heic: "image/heic",
  heif: "image/heif",
  hpp: "text/x-c++",
  htm: "text/html",
  html: "text/html",
  ics: "text/calendar",
  ini: "text/plain",
  iso: "application/x-iso9660-image",
  java: "text/x-java-source",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  jsonc: "application/json",
  jsonl: "application/x-ndjson",
  jsx: "text/javascript",
  kt: "text/x-kotlin",
  log: "text/plain",
  lua: "text/x-lua",
  m4a: "audio/mp4",
  m4v: "video/x-m4v",
  md: "text/markdown",
  markdown: "text/markdown",
  mjs: "text/javascript",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  msi: "application/x-msdownload",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  ogv: "video/ogg",
  opus: "audio/opus",
  otf: "font/otf",
  pdf: "application/pdf",
  php: "application/x-httpd-php",
  pl: "text/x-perl",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ps1: "text/plain",
  psd: "image/vnd.adobe.photoshop",
  py: "text/x-python",
  rar: "application/vnd.rar",
  rb: "text/x-ruby",
  rs: "text/rust",
  rtf: "application/rtf",
  scss: "text/x-scss",
  sh: "application/x-sh",
  sql: "application/sql",
  srt: "application/x-subrip",
  svg: "image/svg+xml",
  swift: "text/x-swift",
  tar: "application/x-tar",
  tgz: "application/gzip",
  tif: "image/tiff",
  tiff: "image/tiff",
  toml: "application/toml",
  ts: "text/typescript",
  tsv: "text/tab-separated-values",
  tsx: "text/typescript",
  ttf: "font/ttf",
  txt: "text/plain",
  vtt: "text/vtt",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  wma: "audio/x-ms-wma",
  wmv: "video/x-ms-wmv",
  woff: "font/woff",
  woff2: "font/woff2",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "text/xml",
  xz: "application/x-xz",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
  zst: "application/zstd",
};

/**
 * Extensionless names that are still text. A dotfile like `.gitignore` reads as
 * all-extension by the rule below, so both spellings are listed.
 */
const TEXT_BY_NAME = new Set([
  ".editorconfig",
  ".env",
  ".gitattributes",
  ".gitignore",
  ".prettierrc",
  "authors",
  "changelog",
  "dockerfile",
  "editorconfig",
  "env",
  "gitattributes",
  "gitignore",
  "license",
  "makefile",
  "notice",
  "procfile",
  "readme",
]);

/** Lowercased characters after the final dot, or "" when there is no extension. */
export function fileExtension(filename: string): string {
  const name = filename.slice(filename.lastIndexOf("/") + 1);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? "" : name.slice(dotIndex + 1).toLowerCase();
}

/** The best content type the name alone supports, or null when it supports none. */
export function mimeTypeForFilename(filename: string): string | null {
  const name = filename.slice(filename.lastIndexOf("/") + 1).toLowerCase();
  const extension = fileExtension(name);
  if (extension) return MIME_BY_EXTENSION[extension] ?? null;
  return TEXT_BY_NAME.has(name) ? "text/plain" : null;
}

/**
 * Splits RFC 4180-ish delimited text. Quotes only open a field at its start,
 * `""` inside a quoted field is one quote, and a newline inside quotes belongs
 * to the value — which is exactly the case a `split("\n")` gets wrong, and the
 * one that shifts every later column by one.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Whether a leading slice of a file is binary.
 *
 * A NUL byte settles it outright — no text encoding this app can render
 * contains one. Past that the test is how much of the slice survives a UTF-8
 * decode: real text produces almost no replacement characters and very few
 * control bytes, while a compressed or executable file produces both in bulk.
 * The thresholds are non-zero on purpose, so one mojibake byte in a log does
 * not cost the whole preview.
 */
export function looksBinary(bytes: Uint8Array, truncated: boolean): boolean {
  if (bytes.length === 0) return false;
  // A range boundary can fall inside a multi-byte sequence, which would decode
  // as damage the file does not have.
  const view = truncated
    ? bytes.subarray(0, Math.max(0, bytes.length - 4))
    : bytes;
  if (view.some((byte) => byte === 0)) return true;

  let control = 0;
  for (const byte of view) {
    if (
      byte < 0x09 ||
      byte === 0x0b ||
      byte === 0x0c ||
      (byte > 0x0d && byte < 0x20)
    ) {
      control += 1;
    }
  }
  if (control / view.length > 0.02) return true;

  const text = new TextDecoder("utf-8").decode(view);
  let replacements = 0;
  for (const char of text) {
    if (char === "�") replacements += 1;
  }
  return replacements / Math.max(1, text.length) > 0.002;
}
