import { Upload } from "tus-js-client";
import { ensureLocalSmokeRuntime } from "./smoke-runtime";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const endpoint = env(
  "TUS_SMOKE_ENDPOINT",
  "http://127.0.0.1:3000/api/storage/uploads",
);
const apiKey = env("TUS_SMOKE_API_KEY");
const targetFolder = env("TUS_SMOKE_TARGET_FOLDER");
const runtime = await ensureLocalSmokeRuntime(endpoint);
const payload = Buffer.from(
  `deniz-cloud tus smoke ${crypto.randomUUID()} `.repeat(2_048),
);
const chunkSize = Math.ceil(payload.byteLength / 3);

function uploadOptions() {
  return {
    endpoint,
    chunkSize,
    headers: { "X-API-Key": apiKey },
    metadata: {
      filename: `tus-smoke-${crypto.randomUUID()}.txt`,
      filetype: "text/plain",
      targetFolder,
    },
    retryDelays: [0, 100, 500],
  };
}

let interruptedUrl: string | null = null;
try {
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(payload, {
      ...uploadOptions(),
      onChunkComplete: (_chunkSize, bytesAccepted) => {
        if (bytesAccepted >= chunkSize && upload.url && !interruptedUrl) {
          interruptedUrl = upload.url;
          void upload.abort().then(resolve, reject);
        }
      },
      onError: reject,
      onSuccess: () =>
        reject(new Error("Upload completed before interruption")),
    });
    upload.start();
  });

  if (!interruptedUrl) throw new Error("TUS upload URL was not assigned");
  const status = await fetch(interruptedUrl, {
    method: "HEAD",
    headers: { "X-API-Key": apiKey, "Tus-Resumable": "1.0.0" },
  });
  const offset = Number(status.headers.get("Upload-Offset"));
  if (!status.ok || offset <= 0 || offset >= payload.byteLength) {
    throw new Error(
      `Interrupted TUS offset was not persisted (${status.status}, ${offset}, ${status.headers.get("Content-Type") ?? "no content type"}, ${interruptedUrl})`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    const resumed = new Upload(payload, {
      ...uploadOptions(),
      onError: reject,
      onSuccess: () => resolve(),
    });
    resumed.url = interruptedUrl;
    resumed.start();
  });

  const completed = await fetch(interruptedUrl, {
    method: "HEAD",
    headers: { "X-API-Key": apiKey, "Tus-Resumable": "1.0.0" },
  });
  if (completed.status !== 410) {
    throw new Error(
      `Expected completed TUS upload to return 410, got ${completed.status}`,
    );
  }
  console.log(
    `TUS smoke passed: interrupted at ${offset}, resumed to ${payload.byteLength}`,
  );
} finally {
  await runtime?.stop();
}
