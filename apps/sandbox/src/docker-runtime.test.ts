import { describe, expect, it } from "bun:test";
import type { SandboxConfig } from "./config";
import { DockerSandboxRuntime } from "./docker-runtime";

const config: SandboxConfig = {
  apiToken: "test-token-that-is-at-least-thirty-two-characters",
  dockerBinary: "docker",
  dockerHost: "unix:///run/user/1001/docker.sock",
  image: "runtime:test",
  runtime: "runsc",
  publicUrl: "https://sandbox.example.test",
  memoryMb: 768,
  cpus: 1.5,
  pids: 128,
  maxSessions: 8,
  requireRootless: true,
};

const result = (stdout = "", exitCode = 0) => ({
  exitCode,
  stdout: Buffer.from(stdout),
  stderr: Buffer.alloc(0),
  timedOut: false,
});

describe("DockerSandboxRuntime", () => {
  it("creates a credential-free, bounded gVisor container", async () => {
    const calls: string[][] = [];
    let index = 0;
    const replies = [result("", 1), result(""), result(""), result("id\n")];
    const runtime = new DockerSandboxRuntime(config, async (argv) => {
      calls.push(argv);
      return replies[index++] ?? result();
    });

    await runtime.createSession({
      conversationId: "conversation",
      ttlSeconds: 900,
    });
    const run = calls.find((call) => call[3] === "run");
    expect(run).toBeDefined();
    expect(run).toContain("runsc");
    expect(run).toContain("none");
    expect(run).toContain("--read-only");
    expect(run).toContain("no-new-privileges");
    expect(run).toContain("ALL");
    expect(run?.join(" ")).not.toContain("MONGODB_URI");
    expect(run?.join(" ")).not.toContain("/var/run/docker.sock");
  });

  it("rejects command working directories outside the workspace", async () => {
    const runtime = new DockerSandboxRuntime(config, async () => result());
    await expect(
      runtime.runCommand("a".repeat(32), {
        command: "python3",
        args: [],
        cwd: "/etc",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("inside /workspace");
  });

  it("signs short-lived preview URLs", () => {
    const runtime = new DockerSandboxRuntime(config, async () => result());
    const url = new URL(runtime.portUrl("a".repeat(32), 3000));
    const [expires = "", signature = ""] =
      url.pathname.split("/proxy/")[1]?.split("/") ?? [];
    expect(
      runtime.verifyPortToken("a".repeat(32), 3000, expires, signature),
    ).toBe(true);
    expect(
      runtime.verifyPortToken("b".repeat(32), 3000, expires, signature),
    ).toBe(false);
  });
});
