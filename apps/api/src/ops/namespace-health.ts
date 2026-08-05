import {
  type Database,
  type MetadataClientOptions,
  type NamespaceHealth,
  NamespaceMetadataClient,
  namespaceHealth,
  namespaceProjectionErrors,
  namespaceProjectionState,
  namespaceReapCandidates,
  namespaceScans,
} from "@repo/cloud-core";
import { desc, eq, isNull, sql } from "drizzle-orm";

export interface NamespaceHealthOptions {
  db: Database;
  metadata: MetadataClientOptions | null;
  /** Absent in legacy mode, where there is no namespace to report on. */
  enabled: boolean;
}

export interface NamespaceHealthReport extends NamespaceHealth {
  enabled: boolean;
  lastCompleteGeneration: number | null;
  reapCandidates: number;
  unrepairedProblems: number;
  watcherOverflows: number;
}

const LEGACY_REPORT: NamespaceHealthReport = {
  dirtyAgeSeconds: null,
  enabled: false,
  lastCompleteAgeSeconds: null,
  lastCompleteGeneration: null,
  reapCandidates: 0,
  reasons: [],
  status: "ok",
  unrepairedProblems: 0,
  watcherOverflows: 0,
};

/**
 * Ops view of the namespace projection.
 *
 * The metadata service is probed rather than assumed reachable: it is the only
 * component that can confirm the namespace is mounted, and a health report that
 * inferred its state from database rows alone would stay green while the
 * namespace was gone.
 */
export async function collectNamespaceHealth(
  options: NamespaceHealthOptions,
): Promise<NamespaceHealthReport> {
  if (!options.enabled) return LEGACY_REPORT;

  const [state] = await options.db.select().from(namespaceProjectionState);
  const [problems] = await options.db
    .select({ count: sql<number>`count(*)::int` })
    .from(namespaceProjectionErrors)
    .where(isNull(namespaceProjectionErrors.repairedAt));
  const [candidates] = await options.db
    .select({ count: sql<number>`count(*)::int` })
    .from(namespaceReapCandidates);
  const [lastComplete] = await options.db
    .select({
      finishedAt: namespaceScans.finishedAt,
      generation: namespaceScans.generation,
    })
    .from(namespaceScans)
    .where(eq(namespaceScans.complete, true))
    .orderBy(desc(namespaceScans.generation))
    .limit(1);

  let metadataReachable = false;
  let namespaceMounted = false;
  if (options.metadata) {
    try {
      const client = new NamespaceMetadataClient({
        ...options.metadata,
        timeoutMs: 2_000,
      });
      // Statting the root is the cheapest question that only a mounted
      // namespace behind a live service can answer.
      await client.stat("/");
      metadataReachable = true;
      namespaceMounted = true;
    } catch (error) {
      // A reachable service that reports the namespace unmounted is a
      // different failure from an unreachable one, and both are critical.
      metadataReachable =
        error instanceof Error && !/unreachable/i.test(error.message);
    }
  }

  const unrepairedProblems = problems?.count ?? 0;
  const reapCandidates = candidates?.count ?? 0;
  const watcherOverflows = state?.watcherOverflows ?? 0;

  const health = namespaceHealth({
    branchesValid: namespaceMounted,
    dirty: state?.dirty ?? true,
    dirtySince: state?.dirtySince ?? null,
    lastCompleteAt: lastComplete?.finishedAt ?? null,
    lastCompleteGeneration: lastComplete?.generation ?? null,
    metadataServiceReachable: metadataReachable,
    namespaceMounted,
    reapCandidates,
    unrepairedProblems,
    watcherOverflows,
  });

  return {
    ...health,
    enabled: true,
    lastCompleteGeneration: lastComplete?.generation ?? null,
    reapCandidates,
    unrepairedProblems,
    watcherOverflows,
  };
}
