/**
 * End to end against the live stack: web's admin API → the runner on Forge →
 * GitHub → the release offer → merge. Plans a three-slot sprint (implement,
 * review, release with no CI) on a throwaway repository, activates it, waits
 * for the offer, merges it, and prints one JSON summary line.
 *
 *   SPRINT_E2E_API_KEY=… bun run e2e
 *
 * Env: SPRINT_E2E_API_KEY (a web admin API key, required),
 * SPRINT_E2E_WEB_URL (default https://denizlg24.com),
 * SPRINT_E2E_REPO (default denizlg24/sprint-e2e),
 * SPRINT_E2E_TIMEOUT_MINUTES (default 60),
 * SPRINT_E2E_CREDENTIAL (subscription | gateway, default subscription).
 */
import {
  type CreateSprintInput,
  type CreateSprintSlotInput,
  runCredentialSchema,
  type Sprint,
  type SprintDetail,
  type SprintSlot,
  sprintDetailSchema,
  sprintSchema,
  sprintSlotSchema,
} from "@repo/schemas";
import { z } from "zod";

const env = z
  .object({
    SPRINT_E2E_API_KEY: z.string().min(1),
    SPRINT_E2E_WEB_URL: z.url().default("https://denizlg24.com"),
    SPRINT_E2E_REPO: z.string().default("denizlg24/sprint-e2e"),
    SPRINT_E2E_TIMEOUT_MINUTES: z.coerce.number().int().min(5).default(60),
    SPRINT_E2E_CREDENTIAL: runCredentialSchema.default("subscription"),
  })
  .parse(process.env);

const base = `${env.SPRINT_E2E_WEB_URL.replace(/\/$/, "")}/api/admin/sprints`;
const POLL_MS = 15_000;
const startedAt = Date.now();
const deadline = startedAt + env.SPRINT_E2E_TIMEOUT_MINUTES * 60_000;

class E2eFailure extends Error {}

async function call<T>(
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.SPRINT_E2E_API_KEY}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new E2eFailure(`${method} ${path} → ${response.status} ${text}`);
  }
  return schema.parse(JSON.parse(text));
}

const sprintEnvelope = z.object({ sprint: sprintSchema });
const slotEnvelope = z.object({ slot: sprintSlotSchema });

function at(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

async function poll(
  sprintId: string,
  done: (detail: SprintDetail) => boolean,
  label: string,
): Promise<SprintDetail> {
  for (;;) {
    const detail = await call("GET", `/${sprintId}`, sprintDetailSchema);
    const failed = detail.slots.find(
      (slot) => slot.status === "failed" || slot.status === "skipped",
    );
    if (failed) {
      const run = detail.runs.find(
        (candidate) => candidate.slotId === failed.id,
      );
      throw new E2eFailure(
        `slot "${failed.title}" ${failed.status}${failed.skipReason ? ` (${failed.skipReason})` : ""}${run?.failure ? `: ${run.failure.code} ${run.failure.message}` : ""}`,
      );
    }
    if (done(detail)) return detail;
    if (Date.now() > deadline) {
      throw new E2eFailure(`timed out waiting for ${label}`);
    }
    await Bun.sleep(POLL_MS);
  }
}

function slotStatuses(slots: readonly SprintSlot[]) {
  return Object.fromEntries(slots.map((slot) => [slot.kind, slot.status]));
}

async function main() {
  const marker = crypto.randomUUID().slice(0, 8);
  const create: CreateSprintInput = {
    title: `e2e ${marker}`,
    goal: `Add E2E-${marker}.md to the repository root, review it, and offer it for release.`,
    repo: env.SPRINT_E2E_REPO,
    defaults: {
      model: "sonnet",
      effort: "low",
      credential: env.SPRINT_E2E_CREDENTIAL,
      timeoutMinutes: 20,
    },
  };
  const { sprint } = await call("POST", "", sprintEnvelope, create);
  let current: Sprint = sprint;

  const slots: CreateSprintSlotInput[] = [
    {
      at: at(1),
      kind: "implement",
      title: "Add the marker file",
      task: `Create E2E-${marker}.md at the repository root containing exactly the line \`${marker}\`. Change nothing else.`,
    },
    {
      at: at(2),
      kind: "review",
      title: "Review the marker file",
      task: `Approve if E2E-${marker}.md exists at the root, contains exactly \`${marker}\`, and nothing else changed. Otherwise request changes.`,
    },
    {
      at: at(3),
      kind: "release",
      title: "Offer the release",
      task: "This repository has no release procedure and no CI. Change nothing; report steps as an empty list and ciRequired false.",
    },
  ];
  for (const slot of slots) {
    await call("POST", `/${sprint.id}/slots`, slotEnvelope, slot);
  }
  ({ sprint: current } = await call(
    "POST",
    `/${sprint.id}/activate`,
    sprintEnvelope,
  ));

  const offered = await poll(
    sprint.id,
    (detail) => detail.sprint.release?.state === "ready",
    "the release offer",
  );
  const review = offered.slots.find((slot) => slot.kind === "review");
  const assertions = {
    prOpened: Boolean(offered.sprint.prUrl),
    reviewSucceeded: review?.status === "succeeded",
    releaseReady: offered.sprint.release?.state === "ready",
  };
  for (const [name, ok] of Object.entries(assertions)) {
    if (!ok) throw new E2eFailure(`assertion failed: ${name}`);
  }

  ({ sprint: current } = await call(
    "POST",
    `/${sprint.id}/merge`,
    sprintEnvelope,
  ));
  const merged = await poll(
    sprint.id,
    (detail) => {
      const state = detail.sprint.release?.state;
      if (state === "failed") {
        throw new E2eFailure(
          `merge failed: ${detail.sprint.release?.error ?? "no error"}`,
        );
      }
      return state === "merged";
    },
    "the merge",
  );
  current = merged.sprint;

  console.log(
    JSON.stringify({
      ok: true,
      sprintId: current.id,
      prUrl: current.prUrl,
      mergeSha: current.release?.mergeSha,
      sprintStatus: current.status,
      slots: slotStatuses(merged.slots),
      runs: merged.runs.length,
      costUsd: merged.runs.reduce(
        (sum, run) => sum + (run.usage?.costUsd ?? 0),
        0,
      ),
      minutes: Math.round((Date.now() - startedAt) / 60_000),
    }),
  );
}

main().catch((error: unknown) => {
  console.log(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      minutes: Math.round((Date.now() - startedAt) / 60_000),
    }),
  );
  process.exit(1);
});
