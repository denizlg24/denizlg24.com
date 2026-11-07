import { afterEach, describe, expect, test } from "bun:test";
import type {
  ClaimedRun,
  RunnerClaimRequest,
  RunnerMergeCommand,
  RunnerPrWatch,
} from "@repo/schemas";
import type { AdmissionDecision } from "./admission";
import { silentLogger } from "./log";
import { RunnerLoop } from "./loop";
import { ServiceTokens } from "./oauth";
import { claimedRun } from "./test-fixtures";
import { WebClient } from "./web-client";

interface FakeWeb {
  url: string;
  claims: RunnerClaimRequest[];
  authorizations: string[];
  tokenRequests: URLSearchParams[];
  queue: Array<{
    runs?: ClaimedRun[];
    commands?: RunnerMergeCommand[];
    prWatches?: RunnerPrWatch[];
  }>;
  stop(): void;
}

let fake: FakeWeb | null = null;

afterEach(() => {
  fake?.stop();
  fake = null;
});

function startFakeWeb(): FakeWeb {
  const state: Omit<FakeWeb, "url" | "stop"> = {
    claims: [],
    authorizations: [],
    tokenRequests: [],
    queue: [],
  };
  let issued = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/oauth2/token") {
        state.tokenRequests.push(new URLSearchParams(await request.text()));
        issued += 1;
        return Response.json({
          access_token: `token-${issued}`,
          expires_in: 300,
        });
      }
      if (url.pathname === "/api/admin/sprints/runner/claim") {
        state.authorizations.push(request.headers.get("authorization") ?? "");
        if (issued === 1 && state.claims.length === 0) {
          state.claims.push(await request.json());
          return new Response("expired", { status: 401 });
        }
        state.claims.push(await request.json());
        const next = state.queue.shift() ?? {};
        return Response.json({
          runs: next.runs ?? [],
          commands: next.commands ?? [],
          prWatches: next.prWatches ?? [],
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    ...state,
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

function loopAgainst(
  web: FakeWeb,
  options: {
    admission?: AdmissionDecision;
    startRun?: (run: ClaimedRun) => Promise<void>;
    merges?: RunnerMergeCommand[];
    watches?: RunnerPrWatch[];
    now?: () => number;
  } = {},
): RunnerLoop {
  const tokens = new ServiceTokens({
    issuer: `${web.url}/api/auth`,
    clientId: "agent-runner",
    clientSecret: "secret",
  });
  const client = new WebClient(
    { url: web.url, resource: "https://denizlg24.com" },
    tokens,
  );
  return new RunnerLoop({
    runnerId: "forge:test",
    web: client,
    admission: async () =>
      options.admission ?? { capacity: 2, admissible: true, reasons: [] },
    startRun: options.startRun ?? (async () => {}),
    merge: async (command) => {
      options.merges?.push(command);
    },
    watchPr: async (watch) => {
      options.watches?.push(watch);
    },
    log: silentLogger,
    now: options.now,
  });
}

describe("RunnerLoop", () => {
  test("claims with a client_credentials token for web, retrying a 401 once", async () => {
    fake = startFakeWeb();
    const loop = loopAgainst(fake);
    await loop.tick();
    expect(fake.tokenRequests).toHaveLength(2);
    expect(fake.tokenRequests[0]?.get("grant_type")).toBe("client_credentials");
    expect(fake.tokenRequests[0]?.get("resource")).toBe(
      "https://denizlg24.com",
    );
    expect(fake.authorizations).toEqual(["Bearer token-1", "Bearer token-2"]);
    expect(fake.claims.at(-1)).toEqual({
      runnerId: "forge:test",
      capacity: 2,
      admissible: true,
    });
  });

  test("sends capacity and admissibility as decided", async () => {
    fake = startFakeWeb();
    const loop = loopAgainst(fake, {
      admission: { capacity: 1, admissible: false, reasons: ["MemAvailable"] },
    });
    await loop.tick();
    expect(fake.claims.at(-1)).toMatchObject({
      capacity: 1,
      admissible: false,
    });
  });

  test("supervises each claimed run once while it is live", async () => {
    fake = startFakeWeb();
    const run = claimedRun();
    fake.queue.push({}, { runs: [run] }, { runs: [run] });
    let release = () => {};
    const started: string[] = [];
    const loop = loopAgainst(fake, {
      startRun: (claimed) => {
        started.push(claimed.runId);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    await loop.tick();
    await loop.tick();
    expect(loop.liveCount).toBe(1);
    await loop.tick();
    expect(started).toEqual([run.runId]);
    release();
    await loop.idle();
    expect(loop.liveCount).toBe(0);
  });

  test("a failed supervisor frees its slot", async () => {
    fake = startFakeWeb();
    fake.queue.push({}, { runs: [claimedRun()] });
    const loop = loopAgainst(fake, {
      startRun: async () => {
        throw new Error("boom");
      },
    });
    await loop.tick();
    await loop.tick();
    await loop.idle();
    expect(loop.liveCount).toBe(0);
  });

  test("hands merge commands over and throttles PR watches", async () => {
    fake = startFakeWeb();
    const command: RunnerMergeCommand = {
      type: "merge",
      sprintId: "s1",
      repo: "denizlg24/sprint-e2e",
      prNumber: 4,
      sha: "a".repeat(40),
    };
    const watch: RunnerPrWatch = {
      sprintId: "s1",
      repo: "denizlg24/sprint-e2e",
      prNumber: 4,
    };
    fake.queue.push(
      {},
      { commands: [command], prWatches: [watch] },
      { prWatches: [watch] },
      { prWatches: [watch] },
    );
    let clock = 1_000_000;
    const merges: RunnerMergeCommand[] = [];
    const watches: RunnerPrWatch[] = [];
    const loop = loopAgainst(fake, { merges, watches, now: () => clock });
    await loop.tick();
    await loop.tick();
    clock += 15_000;
    await loop.tick();
    clock += 60_000;
    await loop.tick();
    await Bun.sleep(0);
    expect(merges).toEqual([command]);
    expect(watches).toHaveLength(2);
  });

  test("stop ends the ticking without waiting for runs", async () => {
    fake = startFakeWeb();
    fake.queue.push({}, { runs: [claimedRun()] });
    const loop = loopAgainst(fake, {
      startRun: () => new Promise<void>(() => {}),
    });
    await loop.tick();
    await loop.tick();
    loop.start();
    await loop.stop();
    expect(loop.liveCount).toBe(1);
  });
});
