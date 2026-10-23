import { runEnrichment } from "@/lib/tmdb";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const result = await runEnrichment({
  limit: limitArg ? Number(limitArg.slice("--limit=".length)) : 2000,
  log: (message) => console.error(message),
});
console.log(JSON.stringify(result));
process.exit(0);
