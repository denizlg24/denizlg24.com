import { MAX_PAPER_PDF_BYTES } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { uploadStreamToStorage } from "@/lib/storage-api";

export const runtime = "nodejs";
export const maxDuration = 300;

const PDF_SIGNATURE = "%PDF-";

/**
 * Reads only as far as the magic bytes and hands back what it consumed, so the
 * signature can be checked before the PUT opens without buffering the document.
 */
async function readSignature(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const head: Uint8Array[] = [];
  let headBytes = 0;
  while (headBytes < PDF_SIGNATURE.length) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.byteLength === 0) continue;
    head.push(value);
    headBytes += value.byteLength;
  }
  const joined = new Uint8Array(headBytes);
  let offset = 0;
  for (const chunk of head) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    head,
    signature: new TextDecoder().decode(
      joined.subarray(0, PDF_SIGNATURE.length),
    ),
  };
}

/** Re-emits the bytes the signature check consumed, then the rest as it lands. */
function restOfBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  head: Uint8Array[],
): ReadableStream<Uint8Array> {
  let headIndex = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const buffered = head[headIndex];
      if (buffered) {
        headIndex += 1;
        controller.enqueue(buffered);
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * The PDF arrives as the raw request body, not a multipart part. `formData()`
 * would materialise the whole document and `uploadFileToStorage` would hold a
 * second copy on top of it — a gigabyte resident per upload at the 500MB
 * ceiling, on a host that is also serving everything else.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const nameHeader = request.headers.get("x-upload-filename");
  const fileName = nameHeader ? decodeURIComponent(nameHeader) : "";
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Only PDF files are accepted" },
      { status: 415 },
    );
  }

  // A stream cannot be measured, and S3 wants the length before the first byte
  // goes out, so the declared length is the only authority on the size.
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isInteger(declaredLength) || declaredLength <= 0) {
    return NextResponse.json(
      { error: "Upload requires a Content-Length" },
      { status: 411 },
    );
  }
  if (declaredLength > MAX_PAPER_PDF_BYTES) {
    return NextResponse.json(
      {
        error: `PDF must be between 1 byte and ${MAX_PAPER_PDF_BYTES / (1024 * 1024)}MB`,
      },
      { status: 413 },
    );
  }
  if (!request.body) {
    return NextResponse.json({ error: "No PDF provided" }, { status: 400 });
  }

  const reader = request.body.getReader();
  try {
    const { head, signature } = await readSignature(reader);
    if (signature !== PDF_SIGNATURE) {
      await reader.cancel();
      return NextResponse.json({ error: "Invalid PDF file" }, { status: 415 });
    }

    const uploaded = await uploadStreamToStorage(
      restOfBody(reader, head),
      {
        filename: fileName,
        mimeType: "application/pdf",
        sizeBytes: declaredLength,
      },
      "file",
    );

    return NextResponse.json({
      pdf: {
        url: uploaded.publicUrl,
        storageKey: uploaded.id,
        fileName,
        mimeType: "application/pdf" as const,
        sizeBytes: uploaded.sizeBytes,
      },
    });
  } catch (error) {
    await reader.cancel().catch(() => {});
    console.error("Failed to upload paper PDF:", error);
    return NextResponse.json(
      { error: "Failed to upload PDF" },
      { status: 500 },
    );
  }
}
