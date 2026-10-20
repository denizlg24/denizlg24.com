import { expect, it } from "bun:test";

it("uses GET metadata for a readable photo refused by HEAD and preserves access failures", async () => {
  const previousEnv = { ...process.env };
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (path === "/photos") return new Response(null);
      if (path.endsWith("missing.jpg"))
        return new Response(null, { status: 404 });
      if (request.method === "HEAD") return new Response(null, { status: 403 });
      if (path.endsWith("forbidden.jpg"))
        return new Response(
          "<Error><Code>AccessDenied</Code><Message>Access denied</Message></Error>",
          { status: 403, headers: { "content-type": "application/xml" } },
        );
      return new Response(new Uint8Array([255, 216, 255]), {
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      });
    },
  });
  try {
    const { inspectBodyPhoto } = await import("./storage");
    process.env.MACROS_S3_ENDPOINT = server.url.origin;
    process.env.MACROS_S3_BUCKET = "photos";
    process.env.MACROS_S3_REGION = "eu-west-1";
    process.env.MACROS_S3_ACCESS_KEY_ID = "test-access-key";
    process.env.MACROS_S3_SECRET_ACCESS_KEY = "test-secret-key";
    const readable = await inspectBodyPhoto("readable.jpg");
    expect(readable.ContentType).toBe("image/jpeg");
    expect(readable.ContentLength).toBe(3);
    for (const key of ["forbidden.jpg", "missing.jpg"]) {
      await expect(inspectBodyPhoto(key)).rejects.toBeDefined();
    }
    expect(requests).toEqual([
      "HEAD /photos/readable.jpg",
      "GET /photos/readable.jpg",
      "HEAD /photos/forbidden.jpg",
      "GET /photos/forbidden.jpg",
      "HEAD /photos/missing.jpg",
    ]);
  } finally {
    server.stop(true);
    for (const key of [
      "MACROS_S3_ENDPOINT",
      "MACROS_S3_BUCKET",
      "MACROS_S3_REGION",
      "MACROS_S3_ACCESS_KEY_ID",
      "MACROS_S3_SECRET_ACCESS_KEY",
    ]) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
