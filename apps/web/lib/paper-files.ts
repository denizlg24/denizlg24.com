import type { PaperFile } from "@repo/schemas";

export function remotePdfFromUrl(url: string): PaperFile | undefined {
  try {
    const parsed = new URL(url);
    const isPdf =
      parsed.pathname.toLowerCase().endsWith(".pdf") ||
      (parsed.hostname.toLowerCase().endsWith("arxiv.org") &&
        parsed.pathname.toLowerCase().startsWith("/pdf/"));
    if (!isPdf) return undefined;
    const fallback = parsed.pathname.split("/").filter(Boolean).at(-1);
    const fileName = `${(fallback || "paper.pdf").replace(/\.pdf$/i, "")}.pdf`;
    return {
      url,
      fileName,
      mimeType: "application/pdf",
      sizeBytes: 0,
    };
  } catch {
    return undefined;
  }
}
