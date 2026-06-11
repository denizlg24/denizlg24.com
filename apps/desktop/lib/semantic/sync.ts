import type { denizApi } from "@/lib/api-wrapper";
import type { ISemanticRun } from "@/lib/data-types";

interface RunProgress {
  stage: string;
  current?: number;
  total?: number;
}

interface SemanticSyncResponse {
  run: ISemanticRun | null;
  processed: number;
  failed: number;
  remaining: number;
  suggestionCount: number;
}

function isApiError<T>(value: T | { code: number; message: string }): value is {
  code: number;
  message: string;
} {
  return Boolean(value && typeof value === "object" && "code" in value);
}

export async function runSemanticSync({
  api,
  onProgress,
  force = false,
}: {
  api: denizApi;
  onProgress?: (progress: RunProgress) => void;
  force?: boolean;
}) {
  if (force) {
    const batchSize = 5;
    let totalProcessed = 0;
    let totalFailed = 0;
    let totalSuggestions = 0;
    let latestRun: ISemanticRun | null = null;

    while (true) {
      onProgress?.({
        stage:
          totalProcessed === 0
            ? "Starting keyword backfill"
            : `Backfilled ${totalProcessed}; checking remaining`,
      });
      const result = await api.POST<SemanticSyncResponse>({
        endpoint: "semantic/sync",
        body: { force: true, missingOnly: true, limit: batchSize },
      });

      if (isApiError(result)) throw new Error(result.message);

      totalProcessed += result.processed;
      totalFailed += result.failed;
      totalSuggestions += result.suggestionCount;
      latestRun = result.run;

      onProgress?.({
        stage: `Backfilled ${totalProcessed}; ${result.remaining} remaining`,
        current: totalProcessed,
        total: totalProcessed + result.remaining,
      });

      if (result.remaining <= 0) break;
      if (result.processed === 0) {
        throw new Error(
          `Keyword backfill stopped: ${result.remaining} notes remain and ${totalFailed} notes failed.`,
        );
      }
    }

    onProgress?.({ stage: "Complete" });
    return {
      run: latestRun,
      embeddedCount: totalProcessed,
      edgeCount: 0,
      failedCount: totalFailed,
      suggestionCount: totalSuggestions,
    };
  }

  onProgress?.({
    stage: "Running server semantic sync",
  });
  const result = await api.POST<SemanticSyncResponse>({
    endpoint: "semantic/sync",
    body: { force },
  });

  if (isApiError(result)) throw new Error(result.message);

  onProgress?.({ stage: "Complete" });
  return {
    run: result.run,
    embeddedCount: result.processed,
    edgeCount: 0,
    suggestionCount: result.suggestionCount,
  };
}
