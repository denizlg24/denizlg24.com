/**
 * Folds every published release's metadata into one SideStore source.
 *
 *   bun scripts/compose-source.ts --releases dir/ --out source.json
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  assertReleaseMetadata,
  composeSource,
  type ReleaseMetadata,
} from "./sidestore-source";
import { appListing, sourceListing } from "./source-listing";

const { values } = parseArgs({
  options: {
    releases: { type: "string" },
    out: { type: "string" },
  },
});

if (!values.releases || !values.out) {
  throw new Error("--releases and --out are required");
}

const files = (await readdir(values.releases)).filter((name) =>
  name.endsWith(".json"),
);
const releases: ReleaseMetadata[] = [];
for (const name of files) {
  const raw: unknown = await Bun.file(join(values.releases, name)).json();
  releases.push(assertReleaseMetadata(raw));
}

const source = composeSource(sourceListing, appListing, releases);
await Bun.write(values.out, `${JSON.stringify(source, null, 2)}\n`);
console.log(
  `Composed ${source.apps[0]?.versions.length ?? 0} version(s); latest ${source.apps[0]?.versions[0]?.version}`,
);
