import { runImdbIngest } from "@/lib/ingest";

const withEpisodes = !process.argv.includes("--no-episodes");
const stats = await runImdbIngest({
  withEpisodes,
  log: (message) => console.error(message),
});
console.log(JSON.stringify(stats));
process.exit(0);
