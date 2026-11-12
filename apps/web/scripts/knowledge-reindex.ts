import { CHUNKER_VERSION } from "@repo/utils/knowledge-chunk";
import mongoose from "mongoose";
import { listAllSourceKeys } from "@/lib/knowledge/catalog";
import { processKnowledgeSource } from "@/lib/knowledge/process";
import { knowledgeCoverage } from "@/lib/knowledge/status";
import { connectDB } from "@/lib/mongodb";
import { KnowledgeSourceState } from "@/models/KnowledgeSourceState";

/**
 * Backfills chunks and vectors for every note, transcribed voice note and
 * document. Dry run unless --execute. Sources already embedded at the current
 * chunker version are skipped unless --force.
 */

const CONCURRENCY = 3;

interface Options {
  execute: boolean;
  force: boolean;
  limit: number;
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    execute: false,
    force: false,
    limit: Number.POSITIVE_INFINITY,
  };
  for (const argument of args) {
    if (argument === "--execute") options.execute = true;
    else if (argument === "--force") options.force = true;
    else if (argument.startsWith("--limit=")) {
      options.limit = Number(argument.slice("--limit=".length));
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Knowledge reindex

Usage:
  bun --env-file=../../.env scripts/knowledge-reindex.ts
  bun --env-file=../../.env scripts/knowledge-reindex.ts --execute [--force] [--limit=N]

Options:
  --execute  Chunk and embed (default is a dry run)
  --force    Reprocess sources that are already embedded at this chunker version
  --limit=N  Process at most N sources`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (Number.isNaN(options.limit) || options.limit < 1) {
    throw new Error("--limit must be a positive number");
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  await connectDB();
  const keys = await listAllSourceKeys();
  const states = await KnowledgeSourceState.find()
    .select("sourceKey state chunkerVersion")
    .lean<
      Array<{ sourceKey: string; state: string; chunkerVersion?: number }>
    >()
    .exec();
  const current = new Set(
    states
      .filter(
        (row) =>
          (row.state === "embedded" || row.state === "empty") &&
          row.chunkerVersion === CHUNKER_VERSION,
      )
      .map((row) => row.sourceKey),
  );
  const todo = keys
    .filter((key) => options.force || !current.has(key))
    .slice(0, options.limit);

  const totals = { processed: 0, embedded: 0, reused: 0, failed: 0 };
  const failures: Array<{ sourceKey: string; error: string }> = [];
  if (options.execute) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < todo.length) {
        const key = todo[cursor];
        cursor += 1;
        if (!key) return;
        try {
          const result = await processKnowledgeSource(key);
          totals.processed += 1;
          totals.embedded += result.embedded;
          totals.reused += result.reused;
          if (result.state === "failed") totals.failed += 1;
        } catch (error) {
          totals.failed += 1;
          failures.push({
            sourceKey: key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (totals.processed % 25 === 0) {
          console.error(`processed ${totals.processed}/${todo.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  console.log(
    JSON.stringify({
      mode: options.execute ? "execute" : "dry-run",
      sources: keys.length,
      upToDate: keys.length - todo.length,
      toProcess: todo.length,
      ...(options.execute
        ? { ...totals, failures: failures.slice(0, 20) }
        : {}),
      coverage: await knowledgeCoverage(),
    }),
  );
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
