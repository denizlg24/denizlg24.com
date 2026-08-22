import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * Drives the real signing path against a local stand-in, so the wire format is
 * asserted rather than assumed. Three things have to hold or a large upload
 * either breaks or eats the host: the transfer must be chunked (which is what
 * proves nothing buffered it), it must not be `aws-chunked` (deniz-cloud
 * answers 501 to that), and the URL must carry a presigned signature.
 */
const CHUNK = new Uint8Array(1024 * 1024).fill(7);
const CHUNKS = 64;
const TOTAL = CHUNK.byteLength * CHUNKS;

let server: ReturnType<typeof Bun.serve>;
let rejectUploads = false;
const puts: Array<{
  url: string;
  headers: Record<string, string>;
  bytes: number;
}> = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    maxRequestBodySize: 1024 * 1024 * 1024,
    async fetch(request) {
      if (request.method === "HEAD") return new Response(null, { status: 200 });
      if (rejectUploads) {
        return new Response("<Error>AccessDenied</Error>", { status: 403 });
      }
      let bytes = 0;
      const reader = request.body?.getReader();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
      puts.push({
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        bytes,
      });
      return new Response(null, { status: 200, headers: { ETag: '"e"' } });
    },
  });

  process.env.STORAGE_S3_ENDPOINT = `http://localhost:${server.port}`;
  process.env.STORAGE_S3_ACCESS_KEY_ID = "test-key";
  process.env.STORAGE_S3_SECRET_ACCESS_KEY = "test-secret";
  process.env.STORAGE_S3_BUCKET = "test-bucket";
  process.env.NEXT_PUBLIC_SITE_URL = "https://denizlg24.com";
});

afterAll(() => server?.stop(true));

function pdfStream(chunks: number): ReadableStream<Uint8Array> {
  let emitted = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunks) return controller.close();
      emitted += 1;
      controller.enqueue(CHUNK);
    },
  });
}

describe("uploadStreamToStorage", () => {
  it("streams the body to a presigned PUT instead of buffering it", async () => {
    const { uploadStreamToStorage } = await import("./storage-api");
    puts.length = 0;

    const result = await uploadStreamToStorage(
      pdfStream(CHUNKS),
      {
        filename: "big scan.pdf",
        mimeType: "application/pdf",
        sizeBytes: TOTAL,
      },
      "file",
    );

    const put = puts.at(-1);
    expect(put).toBeDefined();
    expect(put?.bytes).toBe(TOTAL);

    // Chunked with no declared length is what a streamed body looks like; a
    // buffered one would have arrived with a Content-Length.
    expect(put?.headers["transfer-encoding"]).toBe("chunked");
    expect(put?.headers["content-length"]).toBeUndefined();
    // The encoding deniz-cloud rejects, which the SDK's own PUT would have used.
    expect(put?.headers["content-encoding"]).toBeUndefined();
    expect(put?.headers["content-type"]).toBe("application/pdf");

    const query = new URL(put?.url ?? "").searchParams;
    expect(query.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(query.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // Only `host` is signed, so the content type rides along unsigned — which
    // is what `putObject` reads to type the stored object, and what keeps this
    // from breaking the moment a header is added.
    expect(query.get("X-Amz-SignedHeaders")).toBe("host");

    expect(result.sizeBytes).toBe(TOTAL);
    expect(result.mimeType).toBe("application/pdf");
    // Slugified, uuid-suffixed, and still under the `file` prefix.
    expect(result.id).toMatch(/^uploads\/files\/big-scan-[0-9a-f-]+\.pdf$/);
    expect(result.publicUrl).toContain("/api/file/uploads/files/big-scan-");
  }, 60_000);

  it("surfaces a storage rejection instead of reporting a stored file", async () => {
    const { uploadStreamToStorage } = await import("./storage-api");
    rejectUploads = true;
    try {
      await expect(
        uploadStreamToStorage(
          pdfStream(1),
          {
            filename: "x.pdf",
            mimeType: "application/pdf",
            sizeBytes: CHUNK.byteLength,
          },
          "file",
        ),
      ).rejects.toThrow(/HTTP 403/);
    } finally {
      rejectUploads = false;
    }
  });
});
