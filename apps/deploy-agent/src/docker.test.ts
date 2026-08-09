import { describe, expect, test } from "bun:test";

import { DockerClient, type FetchLike } from "./docker";

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

  function client() {
    const fetchImplementation: FetchLike = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/containers/json") {
        expect(url.searchParams.get("filters")).toContain("forge.deployment");
        return Response.json([container]);
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
        const frames = [
          dockerFrame("2026-08-09T12:00:00Z ready\n"),
          dockerFrame("2026-08-09T12:00:01Z warning\n", 2),
        ];
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const frame of frames) controller.enqueue(frame);
              controller.close();
            },
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
});
