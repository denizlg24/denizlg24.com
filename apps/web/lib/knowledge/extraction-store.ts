import { gunzipSync, gzipSync } from "node:zlib";
import type { PdfSource } from "@repo/utils/knowledge-chunk";
import mongoose from "mongoose";
import { StudyDocumentExtraction } from "@/models/StudyDocumentExtraction";

// A document must stay under Mongo's 16 MB limit even compressed.
const MAX_COMPRESSED_BYTES = 12 * 1024 * 1024;

export async function saveExtraction(
  documentId: string,
  source: PdfSource,
): Promise<void> {
  const data = gzipSync(Buffer.from(JSON.stringify(source)));
  if (data.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error("Extracted text layout is too large to store");
  }
  await StudyDocumentExtraction.updateOne(
    { documentId: new mongoose.Types.ObjectId(documentId) },
    { $set: { data, itemCount: source.items.length } },
    { upsert: true },
  );
}

export async function loadExtraction(
  documentId: string,
): Promise<PdfSource | null> {
  const row = await StudyDocumentExtraction.findOne({
    documentId: new mongoose.Types.ObjectId(documentId),
  })
    .select("data")
    .exec();
  if (!row) return null;
  const source: PdfSource = JSON.parse(gunzipSync(row.data).toString("utf8"));
  return source;
}

export async function deleteExtraction(documentId: string): Promise<void> {
  await StudyDocumentExtraction.deleteOne({
    documentId: new mongoose.Types.ObjectId(documentId),
  });
}
