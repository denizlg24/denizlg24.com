import { describe, expect, test } from "bun:test";

import {
  DockerClient,
  type FetchLike,
  ForgeContainerNotFoundError,
  parseForgeImageTags,
} from "./docker";

describe("parseForgeImageTags", () => {
  test("reads the project slug out of a build tag", () => {
    expect(parseForgeImageTags(["forge/hello-world:a1b2c3d-7f3e9a01"])).toEqual(
      { projectSlug: "hello-world", isCacheTag: false },
    );
  });

  // The one image per project that legitimately has no container, so the list
  // has to be able to say so rather than showing it as reclaimable.
  test("flags the moving cache tag", () => {
    expect(parseForgeImageTags(["forge/api:latest"])).toEqual({
      projectSlug: "api",
      isCacheTag: true,
    });
    expect(
      parseForgeImageTags(["forge/api:a1b2c3d-7f3e9a01", "forge/api:latest"]),
    ).toEqual({ projectSlug: "api", isCacheTag: true });
  });

  test("ignores anything that is not a Forge tag", () => {
    expect(parseForgeImageTags([])).toEqual({
      projectSlug: null,
      isCacheTag: false,
    });
    expect(parseForgeImageTags(["<none>:<none>", "node:22"])).toEqual({
      projectSlug: null,
      isCacheTag: false,
    });
  });
});

function dockerFrame(text: string, stream = 1): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const result = new Uint8Array(8 + payload.byteLength);
  result[0] = stream;
  new DataView(result.buffer).setUint32(4, payload.byteLength);
  result.set(payload, 8);
  return result;
}

describe("DockerClient Forge telemetry", () => {
  const container = {
    Id: "container-1",
    Names: ["/forge-app-1"],
    Image: "forge/app:latest",
    ImageID: "sha256:image-1",
    State: "running",
    Status: "Up 5 minutes (healthy)",
    Created: 1_786_284_000,
    Labels: {
      "forge.deployment": "deployment-1",
      "forge.target": "target-1",
      "forge.project": "app",
      "forge.kind": "production",
    },
  };

  function client(
    options: {
      containers?: (typeof container)[];
      logChunks?: Uint8Array[];
      keepLogsOpen?: boolean;
      onLogCancel?: () => void;
    } = {},
  ) {
    const fetchImplementation: FetchLike = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/containers/json") {
        expect(url.searchParams.get("filters")).toContain("forge.deployment");
        return Response.json(options.containers ?? [container]);
      }
      if (url.pathname.endsWith("/stats")) {
        return Response.json({
          cpu_stats: {
            cpu_usage: { total_usage: 300 },
            system_cpu_usage: 1000,
            online_cpus: 2,
          },
          precpu_stats: {
            cpu_usage: { total_usage: 100 },
            system_cpu_usage: 500,
          },
          memory_stats: { usage: 256, limit: 1024 },
          networks: { eth0: { rx_bytes: 10, tx_bytes: 20 } },
          blkio_stats: {
            io_service_bytes_recursive: [
              { op: "read", value: 30 },
              { op: "write", value: 40 },
            ],
          },
          pids_stats: { current: 3 },
        });
      }
      if (url.pathname === "/images/json") {
        return Response.json([
          {
            Id: "sha256:image-1",
            RepoTags: ["forge/app:latest"],
            Created: 1_786_284_000,
            Size: 2048,
            SharedSize: -1,
          },
        ]);
      }
      if (url.pathname.endsWith("/logs")) {
        const frames = options.logChunks ?? [
          dockerFrame("2026-08-09T12:00:00Z ready\n"),
          dockerFrame("2026-08-09T12:00:01Z warning\n", 2),
        ];
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const frame of frames) controller.enqueue(frame);
              if (!options.keepLogsOpen) controller.close();
            },
            cancel: options.onLogCancel,
          }),
        );
      }
      return new Response("not found", { status: 404 });
    };
    return new DockerClient({
      socketPath: "/var/run/docker.sock",
      fetchImplementation,
    });
  }

  test("lists only labeled containers and derives their stats", async () => {
    const docker = client();
    const [listed] = await docker.listForgeContainers();
    expect(listed?.deploymentId).toBe("deployment-1");
    const stats = await docker.forgeContainerStats(listed!);
    expect(stats).toEqual({
      cpuPercent: 80,
      memoryBytes: 256,
      memoryLimitBytes: 1024,
      memoryPercent: 25,
      networkRxBytes: 10,
      networkTxBytes: 20,
      blockReadBytes: 30,
      blockWriteBytes: 40,
      pids: 3,
    });
  });

  test("links images to their running containers", async () => {
    const docker = client();
    const containers = await docker.listForgeContainers();
    const [image] = await docker.listForgeImages(containers);
    expect(image?.tags).toEqual(["forge/app:latest"]);
    expect(image?.containerIds).toEqual(["container-1"]);
  });

  test("demultiplexes stdout and stderr runtime logs", async () => {
    const lines: string[] = [];
    for await (const line of client().forgeContainerLogs("deployment-1")) {
      lines.push(line);
    }
    expect(lines).toEqual([
      "2026-08-09T12:00:00Z ready",
      "2026-08-09T12:00:01Z warning",
    ]);
  });

  // Docker interleaves the two streams arbitrarily, and a write need not end on
  // a newline. Sharing one partial-line buffer splices an unterminated stdout
  // write onto the next stderr frame and labels the result with whichever came
  // first — corrupting both the text and the stream it is attributed to.
  test("keeps a partial line per stream when the two interleave", async () => {
    const entries = await client({
      logChunks: [
        dockerFrame("out-start", 1),
        dockerFrame("err-whole\n", 2),
        dockerFrame("-out-end\n", 1),
      ],
    }).forgeContainerLogWindow("deployment-1", {
      since: new Date(0),
      until: new Date(1),
    });
    expect(entries).toEqual([
      { stream: "stderr", line: "err-whole" },
      { stream: "stdout", line: "out-start-out-end" },
    ]);
  });

  test("keeps only the newest lines once a window passes its cap", async () => {
    const entries = await client({
      logChunks: [dockerFrame("one\ntwo\nthree\nfour\n", 1)],
    }).forgeContainerLogWindow("deployment-1", {
      since: new Date(0),
      until: new Date(1),
      maxEntries: 2,
    });
    expect(entries.map((entry) => entry.line)).toEqual(["three", "four"]);
  });

  test("streams unframed TTY logs", async () => {
    const lines: string[] = [];
    const plain = new TextEncoder().encode("first\nsecond\n");
    for await (const line of client({ logChunks: [plain] }).forgeContainerLogs(
      "deployment-1",
    )) {
      lines.push(line);
    }
    expect(lines).toEqual(["first", "second"]);
  });

  test("rejects a truncated framed log response", async () => {
    const frame = dockerFrame("incomplete");
    await expect(
      (async () => {
        for await (const _line of client({
          logChunks: [frame.slice(0, -1)],
        }).forgeContainerLogs("deployment-1")) {
          // drain
        }
      })(),
    ).rejects.toThrow("truncated log frame");
  });

  test("cancels the Docker response when a log consumer stops early", async () => {
    let cancelled = false;
    const lines = client({
      logChunks: [dockerFrame("first\n")],
      keepLogsOpen: true,
      onLogCancel: () => {
        cancelled = true;
      },
    }).forgeContainerLogs("deployment-1");

    for await (const _line of lines) break;

    expect(cancelled).toBe(true);
  });

  test("extracts only Docker health suffixes", async () => {
    const listed = await client({
      containers: [
        { ...container, Id: "healthy", Status: "Up 1 minute (healthy)" },
        {
          ...container,
          Id: "prefixed-health",
          Status: "Up 1 minute (health: UNHEALTHY)",
        },
        { ...container, Id: "exited", Status: "Exited (0) 2 minutes ago" },
        { ...container, Id: "paused", Status: "Up 1 minute (Paused)" },
      ],
    }).listForgeContainers();
    expect(listed.map((entry) => entry.health)).toEqual([
      "healthy",
      "unhealthy",
      null,
      null,
    ]);
  });

  test("prefers exact container references over an earlier id prefix", async () => {
    const exact = { ...container, Id: "abc", Names: ["/exact"] };
    const prefix = { ...container, Id: "abcdef", Names: ["/prefix"] };
    const resolved = await client({
      containers: [prefix, exact],
    }).resolveForgeContainer("abc");
    expect(resolved.name).toBe("exact");
  });

  test("does not resolve ambiguous short id prefixes", async () => {
    await expect(
      client({
        containers: [{ ...container, Id: "abcdef1234567890" }],
      }).resolveForgeContainer("abc"),
    ).rejects.toBeInstanceOf(ForgeContainerNotFoundError);
  });
});
