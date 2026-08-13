import { fileExtension, mimeTypeForFilename } from "@repo/schemas/cloud";
import {
  Archive,
  Braces,
  FileAudio,
  FileCode,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Image as ImageIcon,
  type LucideIcon,
  Table,
} from "lucide-react";

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "code"
  | "text"
  | "delimited"
  | "font"
  | "archive"
  | "sheet"
  | "other";

// hljs ships every common grammar, but only these map cleanly from an
// extension. Anything unlisted still previews — just without highlighting.
const CODE_LANGUAGES: Record<string, string> = {
  bash: "bash",
  bat: "dos",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cmake: "cmake",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  dockerfile: "dockerfile",
  ex: "elixir",
  exs: "elixir",
  fish: "bash",
  go: "go",
  gradle: "gradle",
  graphql: "graphql",
  groovy: "groovy",
  h: "c",
  hpp: "cpp",
  hs: "haskell",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  jl: "julia",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  m: "objectivec",
  mjs: "javascript",
  mm: "objectivec",
  patch: "diff",
  php: "php",
  pl: "perl",
  plist: "xml",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  tf: "terraform",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  vim: "vim",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const PLAIN_TEXT_EXTENSIONS = new Set([
  "cfg",
  "conf",
  "eml",
  "env",
  "gitattributes",
  "gitignore",
  "ics",
  "jsonl",
  "log",
  "ndjson",
  "properties",
  "srt",
  "text",
  "txt",
  "vtt",
]);

/** Comma- and tab-separated data, which previews as a table rather than as text. */
const DELIMITED_EXTENSIONS = new Set(["csv", "tsv"]);

const ARCHIVE_EXTENSIONS = new Set([
  "7z",
  "bz2",
  "dmg",
  "gz",
  "iso",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
  "zst",
]);

/** Binary office formats. A zip container is not something to render as text. */
const SHEET_EXTENSIONS = new Set(["ods", "xls", "xlsx"]);

const FONT_EXTENSIONS = new Set(["otf", "ttf", "woff", "woff2"]);

export function extensionOf(filename: string): string {
  return fileExtension(filename);
}

/**
 * What to render a file with.
 *
 * The extension leads and the MIME type follows, which is the opposite of the
 * obvious order: broker-mounted storage only carries a declared type for files
 * uploaded through the API, so 81% of the namespace has none at all. Classifying
 * on MIME first sent every `.mp4` and `.jpg` written over SMB to "No preview".
 * `mimeTypeForFilename` is the same table the API now derives its Content-Type
 * from, so the two sides always agree about what a name means.
 */
export function fileKind(filename: string, mimeType: string | null): FileKind {
  const extension = extensionOf(filename);
  const mime = (
    mimeType?.toLowerCase() ??
    mimeTypeForFilename(filename) ??
    ""
  ).split(";")[0];

  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "pdf" || mime === "application/pdf") return "pdf";
  if (FONT_EXTENSIONS.has(extension) || mime?.startsWith("font/")) {
    return "font";
  }
  if (DELIMITED_EXTENSIONS.has(extension)) return "delimited";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (SHEET_EXTENSIONS.has(extension)) return "sheet";
  // Media before source: an SVG is both, and a rendered one is the more useful
  // of the two previews.
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (extension in CODE_LANGUAGES) return "code";
  if (PLAIN_TEXT_EXTENSIONS.has(extension)) return "text";
  if (mime?.startsWith("text/")) return "text";
  return "other";
}

export function codeLanguage(filename: string): string | null {
  return CODE_LANGUAGES[extensionOf(filename)] ?? null;
}

/** Kinds whose bytes are fetched into memory rather than streamed by the tag. */
export function isTextPreview(kind: FileKind): boolean {
  return kind === "markdown" || kind === "code" || kind === "text";
}

const KIND_ICONS: Record<FileKind, LucideIcon> = {
  archive: Archive,
  audio: FileAudio,
  code: FileCode,
  delimited: Table,
  font: FileType,
  image: ImageIcon,
  markdown: FileType,
  other: FileIcon,
  pdf: FileText,
  sheet: FileSpreadsheet,
  text: FileText,
  video: FileVideo,
};

export function fileIcon(filename: string, mimeType: string | null) {
  const kind = fileKind(filename, mimeType);
  if (kind === "code" && extensionOf(filename) === "json") return Braces;
  return KIND_ICONS[kind];
}
