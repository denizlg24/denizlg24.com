import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

/** Text layer of a PDF, or null when the file is not a readable PDF. */
export async function pdfText(bytes: Uint8Array): Promise<string | null> {
  try {
    const pdf = await getDocumentProxy(bytes);
    return (await extractText(pdf, { mergePages: true })).text;
  } catch {
    return null;
  }
}
