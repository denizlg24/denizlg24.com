import type { SQL } from "bun";
import { handleArchiveRequest } from "./api";
import { type Collector, Scheduler } from "./collector";
import { ensureSchema, openArchive } from "./db";
import { fearGreedCollector } from "./feargreed";
import {
  type ArchiveRuntime,
  flightsCollector,
  registryCollector,
} from "./flights";
import { playCollector } from "./play";
import { archiveLog, errorMessage, sleep } from "./util";
import { wsbCollector } from "./wsb";

export type { ArchiveRuntime } from "./flights";

export const ARCHIVE_COLLECTORS = [
  "wsb",
  "play",
  "flights",
  "feargreed",
] as const;
type CollectorGroup = (typeof ARCHIVE_COLLECTORS)[number];

export interface Archive {
  /** MARKETS_ARCHIVE_DATABASE_URL is set. */
  enabled: boolean;
  /** Schema is in place and the collectors are scheduled. */
  ready(): boolean;
  collectors(): string[];
  handle(url: URL): Promise<Response>;
  stop(): void;
}

const disabled: Archive = {
  enabled: false,
  ready: () => false,
  collectors: () => [],
  handle: async () =>
    Response.json({ detail: "Archive disabled" }, { status: 503 }),
  stop: () => {},
};

export function enabledGroups(
  configured: string | undefined,
): CollectorGroup[] {
  const requested = (configured ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (requested.length === 0) return [...ARCHIVE_COLLECTORS];
  return ARCHIVE_COLLECTORS.filter((name) => requested.includes(name));
}

function buildCollectors(
  sql: SQL,
  groups: CollectorGroup[],
  runtime: ArchiveRuntime,
): Collector[] {
  const collectors: Collector[] = [];
  for (const group of groups) {
    if (group === "wsb") collectors.push(wsbCollector(sql));
    if (group === "play") {
      collectors.push(
        playCollector(sql, process.env.MARKETS_ARCHIVE_PLAY_APPS),
      );
    }
    if (group === "flights") {
      collectors.push(registryCollector(sql, runtime), flightsCollector(sql));
    }
    if (group === "feargreed") collectors.push(fearGreedCollector(sql));
  }
  return collectors;
}

const RETRY_MS = 30_000;

/**
 * Starts the personal data archive when MARKETS_ARCHIVE_DATABASE_URL is set; the
 * relay is unchanged otherwise. Returns at once and connects in the background,
 * retrying: after a Pi reboot the relay can come up before Postgres does.
 */
export function startArchive(runtime: ArchiveRuntime): Archive {
  const url = process.env.MARKETS_ARCHIVE_DATABASE_URL;
  if (!url) return disabled;

  let scheduler: Scheduler | null = null;
  let sql: SQL | null = null;
  let stopped = false;

  const connect = async (): Promise<void> => {
    while (!stopped) {
      try {
        const connection = openArchive(url);
        try {
          await ensureSchema(connection);
        } catch (error) {
          await connection.close().catch(() => {});
          throw error;
        }
        const groups = enabledGroups(process.env.MARKETS_ARCHIVE_COLLECTORS);
        const started = new Scheduler(
          connection,
          buildCollectors(connection, groups, runtime),
        );
        await started.start();
        sql = connection;
        scheduler = started;
        archiveLog(`started: ${groups.join(", ") || "(no collectors)"}`);
        return;
      } catch (error) {
        archiveLog(`startup failed, retrying: ${errorMessage(error)}`);
        await sleep(RETRY_MS);
      }
    }
  };
  void connect();

  return {
    enabled: true,
    ready: () => scheduler !== null,
    collectors: () => scheduler?.statuses().map((status) => status.name) ?? [],
    handle: async (requestUrl) =>
      sql && scheduler
        ? handleArchiveRequest(requestUrl, sql, scheduler)
        : Response.json({ detail: "Archive starting" }, { status: 503 }),
    stop: () => {
      stopped = true;
      scheduler?.stop();
    },
  };
}
