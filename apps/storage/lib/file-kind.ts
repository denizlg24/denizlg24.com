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
} from "lucide-react";

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "code"
  | "text"
  | "archive"
  | "sheet"
  | "other";

// hljs ships every common grammar, but only these map cleanly from an
// extension. Anything unlisted still previews — just without highlighting.
const CODE_LANGUAGES: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  dockerfile: "dockerfile",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  lua: "lua",
  mjs: "javascript",
  php: "php",
  pl: "perl",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const PLAIN_TEXT_EXTENSIONS = new Set([
  "cfg",
  "conf",
  "csv",
  "env",
  "gitignore",
  "log",
  "text",
  "tsv",
  "txt",
]);

const ARCHIVE_EXTENSIONS = new Set([
  "7z",
  "bz2",
  "gz",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
  "zst",
]);

const SHEET_EXTENSIONS = new Set(["csv", "ods", "tsv", "xls", "xlsx"]);

export function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex <= 0 ? "" : filename.slice(dotIndex + 1).toLowerCase();
}

export function fileKind(filename: string, mimeType: string | null): FileKind {
  const extension = extensionOf(filename);
  const mime = mimeType?.toLowerCase() ?? "";

  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "pdf" || mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/") || extension === "svg") return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (SHEET_EXTENSIONS.has(extension)) return "sheet";
  if (extension in CODE_LANGUAGES) return "code";
  if (PLAIN_TEXT_EXTENSIONS.has(extension)) return "text";
  if (mime.startsWith("text/")) return "text";
  return "other";
}

export function codeLanguage(filename: string): string | null {
  return CODE_LANGUAGES[extensionOf(filename)] ?? null;
}

/** Kinds whose bytes are fetched into memory rather than streamed by the tag. */
export function isTextPreview(kind: FileKind): boolean {
  return kind === "markdown" || kind === "code" || kind === "text";
}

export function canPreview(kind: FileKind): boolean {
  return kind !== "archive" && kind !== "other" && kind !== "sheet";
}

const KIND_ICONS: Record<FileKind, LucideIcon> = {
  archive: Archive,
  audio: FileAudio,
  code: FileCode,
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
