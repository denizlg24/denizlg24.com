import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { uploadFileToStorage } from "@/lib/storage-api";
import type { ToolDefinition } from "./types";

const MAX_FETCH_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last || "upload";
  } catch {
    return "upload";
  }
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family !== 6) return true;
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::" || normalized === "::1") return true;
  const mapped = normalized.match(/^::ffff:(.+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(normalized);
}

// The model picks this URL, so it must not be usable to reach the Pi's own
// services, the Docker network, or a cloud metadata endpoint.
async function assertPublicUrl(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new Error(`Refusing to fetch a private address: ${host}`);
    }
    return;
  }
  const resolved = await lookup(host, { all: true }).catch(() => []);
  if (resolved.length === 0) {
    throw new Error(`Could not resolve ${host}`);
  }
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`Refusing to fetch a private address: ${host}`);
  }
}

// Redirects are followed by hand so every hop is re-checked; letting fetch
// follow them would let a public URL bounce to a private one.
async function fetchPublic(initial: string): Promise<Response> {
  let target = new URL(initial);
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(target.protocol)) {
      throw new Error("url must be an http or https URL");
    }
    await assertPublicUrl(target);
    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      target = new URL(location, target);
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects fetching ${initial}`);
}

async function readCappedBody(
  response: Response,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FETCH_BYTES) {
    throw new Error(
      `File is ${declared} bytes; the limit is ${MAX_FETCH_BYTES}.`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error(`File exceeds the ${MAX_FETCH_BYTES} byte limit.`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export const uploadTools: ToolDefinition[] = [
  {
    schema: {
      name: "upload_file_from_url",
      description:
        "Download a file from a public URL and store it in the self-hosted cloud, returning the stored URL. Use it to attach images to projects, blog posts, or timeline items — those tools take a stored URL, not a remote one.",
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Public http(s) URL of the file to fetch.",
          },
          bucket: {
            type: "string",
            description:
              "Storage bucket. Use 'image' for images and 'file' for everything else.",
            enum: ["image", "file"],
          },
          filename: {
            type: "string",
            description:
              "Name to store the file under. Defaults to the URL's last path segment.",
          },
        },
        required: ["url"],
      },
    },
    isWrite: true,
    category: "upload",
    execute: async (input) => {
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) {
        throw new Error("url must be an http or https URL");
      }
      const response = await fetchPublic(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      const buffer = await readCappedBody(response);
      const name =
        typeof input.filename === "string" && input.filename.trim()
          ? input.filename.trim()
          : filenameFromUrl(url);
      const file = new File([buffer], name, {
        type:
          response.headers.get("content-type") ?? "application/octet-stream",
      });
      const bucket = input.bucket === "file" ? "file" : "image";
      return uploadFileToStorage(file, bucket);
    },
  },
  {
    schema: {
      name: "upload_file_from_base64",
      description:
        "Store base64-encoded bytes in the self-hosted cloud and return the stored URL. Use it for files the sandbox generated or that arrived as an attachment.",
      input_schema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Name to store the file under, including extension.",
          },
          base64: {
            type: "string",
            description:
              "Base64-encoded file contents, without a data: prefix.",
          },
          mimeType: {
            type: "string",
            description: "MIME type, for example 'image/png'.",
          },
          bucket: {
            type: "string",
            description:
              "Storage bucket. Use 'image' for images and 'file' for everything else.",
            enum: ["image", "file"],
          },
        },
        required: ["filename", "base64"],
      },
    },
    isWrite: true,
    category: "upload",
    execute: async (input) => {
      const filename =
        typeof input.filename === "string" ? input.filename.trim() : "";
      const base64 = typeof input.base64 === "string" ? input.base64 : "";
      if (!filename) throw new Error("filename is required");
      if (!base64) throw new Error("base64 is required");
      const bytes = Buffer.from(base64.replace(/^data:[^,]+,/, ""), "base64");
      if (bytes.byteLength === 0) throw new Error("base64 decoded to no bytes");
      if (bytes.byteLength > MAX_FETCH_BYTES) {
        throw new Error(
          `File is ${bytes.byteLength} bytes; the limit is ${MAX_FETCH_BYTES}.`,
        );
      }
      const file = new File([bytes], filename, {
        type:
          typeof input.mimeType === "string" && input.mimeType
            ? input.mimeType
            : "application/octet-stream",
      });
      const bucket = input.bucket === "file" ? "file" : "image";
      return uploadFileToStorage(file, bucket);
    },
  },
];
