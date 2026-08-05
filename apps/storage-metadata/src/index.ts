import { chmod, chown, lstat, readFile, unlink } from "node:fs/promises";

import {
  AttrCommandXattrBackend,
  handleMetadataRequest,
  isSupportedProtocolVersion,
  NamespaceMetadataService,
  readBranchMarkers,
  tokenMatches,
} from "@repo/cloud-core";

import { configFromEnv } from "./config";
import { createSmbAgent } from "./smb-agent";
import { WatchBroadcaster } from "./watcher";

const config = configFromEnv();

/**
 * Refuses to serve unless the merged namespace is actually mounted.
 *
 * An unmounted branch presents as an empty directory, and a metadata service
 * answering NOT_FOUND for every entry is indistinguishable from mass deletion
 * to anything downstream. Checked at startup and again on every request, since
 * the watchdog can withdraw the mount underneath a running process.
 */
async function namespaceIsMounted(): Promise<boolean> {
  try {
    const stats = await lstat(config.witnessPath);
    if (!stats.isFile() || stats.isSymbolicLink()) return false;
    const value = await readFile(config.witnessPath, "utf8");
    return value.trimEnd() === config.witnessValue;
  } catch {
    return false;
  }
}

if (!(await namespaceIsMounted())) {
  console.error(
    `Namespace witness is absent or wrong at ${config.witnessPath}; refusing to start`,
  );
  process.exit(1);
}

// Provisioning is only offered when the script is actually installed, so a
// host without it answers UNAVAILABLE rather than failing obscurely.
const smbAgent = config.smbScriptPath
  ? createSmbAgent(config.smbScriptPath)
  : undefined;

const service = new NamespaceMetadataService(
  config.namespaceRoot,
  new AttrCommandXattrBackend(),
);

// A stale socket from an unclean stop would make bind fail; only remove one
// that is actually a socket, never a regular file someone put there.
try {
  const stats = await lstat(config.socketPath);
  if (stats.isSocket()) await unlink(config.socketPath);
} catch {
  // Nothing to clean up.
}

function deny(code: string, message: string, status: number): Response {
  return Response.json({ code, message, ok: false }, { status });
}

/**
 * Newline-delimited JSON, held open for as long as the subscriber wants it.
 *
 * The subscriber treats a closed stream as a gap it cannot account for and
 * falls back to a full scan, so this never has to replay anything: dropping the
 * connection is always a safe way to fail.
 */
function watchStream(request: Request): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
    },
    start(controller) {
      unsubscribe = watcher.subscribe((message) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          // The subscriber went away between the check and the write; the
          // unsubscribe below is what actually stops the flow.
          unsubscribe?.();
          unsubscribe = null;
        }
      });
      request.signal.addEventListener("abort", () => {
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      });
    },
  });

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson",
    },
  });
}

const watcher = new WatchBroadcaster({
  debounceMs: config.watchQuietMs,
  flushMs: config.watchQuietMs,
  maxPending: config.watchMaxPending,
  namespaceRoot: config.namespaceRoot,
});

const server = Bun.serve({
  async fetch(request) {
    if (new URL(request.url).pathname === "/healthz") {
      return (await namespaceIsMounted())
        ? Response.json({ status: "ok" })
        : deny("UNAVAILABLE", "Namespace is not mounted", 503);
    }
    if (request.method !== "POST") {
      return deny("BAD_REQUEST", "Only POST is supported", 405);
    }
    if (!tokenMatches(config.token, request.headers.get("x-metadata-token"))) {
      return deny("BAD_REQUEST", "Bad token", 403);
    }
    if (new URL(request.url).pathname === "/v1/watch") {
      if (
        !isSupportedProtocolVersion(request.headers.get("x-metadata-version"))
      ) {
        return deny("BAD_REQUEST", "Unsupported protocol version", 400);
      }
      if (!(await namespaceIsMounted())) {
        return deny("UNAVAILABLE", "Namespace is not mounted", 503);
      }
      return watchStream(request);
    }
    if (
      !isSupportedProtocolVersion(request.headers.get("x-metadata-version"))
    ) {
      return deny("BAD_REQUEST", "Unsupported protocol version", 400);
    }
    if (!(await namespaceIsMounted())) {
      return deny("UNAVAILABLE", "Namespace is not mounted", 503);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return deny("BAD_REQUEST", "Body is not JSON", 400);
    }
    const response = await handleMetadataRequest(service, body, smbAgent, () =>
      readBranchMarkers(config.branchPaths),
    );
    return Response.json(response, { status: response.ok ? 200 : 409 });
  },
  unix: config.socketPath,
});

// Root-owned, group-owned by the storage gid, mode 0660.
//
// The group must be the *numeric* storage gid rather than a dedicated host
// group: the API reaches this socket from inside a container whose user is
// uid/gid 1000, and container group membership is resolved against the
// container's own /etc/group. A host-only group name means the socket is
// simply unreadable there, and every download fails closed with 503 while the
// service looks healthy.
await chown(config.socketPath, 0, config.socketGid);
await chmod(config.socketPath, 0o660);

console.info(
  JSON.stringify({
    event: "listening",
    namespaceRoot: config.namespaceRoot,
    socket: config.socketPath,
  }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    watcher.stop();
    server.stop();
    void unlink(config.socketPath).catch(() => {});
    process.exit(0);
  });
}
