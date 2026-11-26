import "server-only";
import { chunkPages } from "./chunk";
import { ExtractError, extractDocument } from "./extract";
import { createDocument } from "./store";
import {
  documentLimits,
  symbolListSchema,
  tagListSchema,
  type DocumentUploadResult,
} from "./types";

const splitList = (value: FormDataEntryValue | null) =>
  typeof value === "string"
    ? [
        ...new Set(
          value
            .split(/[\s,;]+/)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];

export function cleanName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? name;
  return (
    base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) ||
    "Untitled"
  );
}

export async function ingestUpload(
  userId: string,
  form: FormData,
): Promise<DocumentUploadResult> {
  const file = form.get("file");
  if (!(file instanceof File)) throw new ExtractError("Attach a file to upload.");
  if (file.size > documentLimits.uploadBytes)
    throw new ExtractError("The file is larger than 25 MB.");
  const symbols = symbolListSchema.safeParse(splitList(form.get("symbols")));
  if (!symbols.success) throw new ExtractError("One of the symbols is not valid.");
  const tags = tagListSchema.safeParse(
    typeof form.get("tags") === "string"
      ? String(form.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean)
      : [],
  );
  if (!tags.success) throw new ExtractError("Too many tags, or a tag is too long.");

  const name = cleanName(file.name);
  const extracted = await extractDocument(name, new Uint8Array(await file.arrayBuffer()));
  const chunks = chunkPages(extracted.pages, {
    target: documentLimits.chunkTarget,
    max: documentLimits.chunkMax,
    repeatFirstLine: extracted.kind === "csv",
  });
  if (!chunks.length) throw new ExtractError("No text found in this file.");
  const meta = await createDocument(userId, {
    name,
    mime: file.type.slice(0, 100) || "application/octet-stream",
    size: file.size,
    kind: extracted.kind,
    pages: extracted.pageCount,
    symbols: symbols.data,
    tags: tags.data,
    chunks,
  });
  return { ...meta, warnings: extracted.warnings };
}
