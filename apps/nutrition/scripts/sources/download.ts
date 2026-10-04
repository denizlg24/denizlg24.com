import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

import { unzipSync } from "fflate";

/**
 * Fetches every composition table into data/sources/<source>/. Downloads are
 * skipped when the file is already present, so a rerun only fills gaps;
 * pass --force to refetch. OpenFoodFacts is not downloaded here: its importer
 * streams the export directly.
 */

const ROOT = "data/sources";
const USER_AGENT = "deniz-nutrition-api/1.1 (+https://nutrition.denizlg24.com)";

const args = {
  force: Bun.argv.includes("--force"),
  only: (() => {
    const index = Bun.argv.indexOf("--only");
    return index === -1 ? undefined : Bun.argv[index + 1]?.split(",");
  })(),
};

const exists = async (path: string) => {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
};

const fetchOk = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": USER_AGENT,
      // canada.ca labels a plain zip as gzip-encoded; asking for identity
      // stops the client from trying to inflate it.
      "accept-encoding": "identity",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
};

const download = async (url: string, path: string) => {
  if (!args.force && (await exists(path))) {
    console.log(`  have ${path}`);
    return;
  }
  const temporary = `${path}.part`;
  const response = await fetchOk(url);
  const total = Number(response.headers.get("content-length") ?? 0);
  // Streamed to disk: the OpenFoodFacts export is 13 GB.
  const writer = Bun.file(temporary).writer();
  let received = 0;
  let reported = 0;
  if (!response.body) throw new Error(`empty body ${url}`);
  const reader = response.body.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    writer.write(chunk);
    received += chunk.byteLength;
    if (total > 500e6 && received - reported > 500e6) {
      reported = received;
      console.log(
        `    ${(received / 1e9).toFixed(1)}/${(total / 1e9).toFixed(1)} GB`,
      );
      await writer.flush();
    }
  }
  await writer.end();
  await rename(temporary, path);
  console.log(
    `  got  ${path} (${((await stat(path)).size / 1e6).toFixed(1)} MB)`,
  );
};

const unzip = async (zipPath: string, into: string) => {
  const marker = join(into, ".unzipped");
  if (!args.force && (await exists(marker))) return;
  const entries = unzipSync(
    new Uint8Array(await Bun.file(zipPath).arrayBuffer()),
  );
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    await Bun.write(join(into, name.split("/").pop() ?? name), bytes);
  }
  await Bun.write(marker, new Date().toISOString());
  console.log(`  unzipped ${Object.keys(entries).length} entries into ${into}`);
};

const fetchJson = async <T>(url: string): Promise<T> =>
  (await (
    await fetchOk(url, { headers: { accept: "application/json" } })
  ).json()) as T;

const mapConcurrent = async <T, R>(
  values: T[],
  limit: number,
  run: (value: T) => Promise<R>,
) => {
  const results: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const index = next++;
        if (index >= values.length) return;
        results[index] = await run(values[index] as T);
      }
    }),
  );
  return results;
};

const FDC = "https://fdc.nal.usda.gov/fdc-datasets";

/** Downloaded only when named with --only. */
const optIn = new Set(["openfoodfacts"]);

const tasks: Record<string, (dir: string) => Promise<void>> = {
  openfoodfacts: async (dir) => {
    await download(
      "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz",
      join(dir, "openfoodfacts-products.jsonl.gz"),
    );
  },
  usda: async (dir) => {
    for (const name of [
      "FoodData_Central_foundation_food_json_2026-04-30",
      "FoodData_Central_sr_legacy_food_json_2018-04",
      "FoodData_Central_survey_food_json_2024-10-31",
    ]) {
      const zip = join(dir, `${name}.zip`);
      await download(`${FDC}/${name}.zip`, zip);
      await unzip(zip, join(dir, name));
    }
  },
  usda_branded: async (dir) => {
    const name = "FoodData_Central_branded_food_csv_2026-04-30";
    const zip = join(dir, `${name}.zip`);
    await download(`${FDC}/${name}.zip`, zip);
    // 450 MB zipped, several GB inflated: unzip(1) streams where fflate would
    // need the whole archive in memory.
    const target = join(dir, name);
    if (args.force || !(await exists(join(target, ".unzipped")))) {
      await mkdir(target, { recursive: true });
      const proc = Bun.spawn(["unzip", "-o", "-j", "-q", zip, "-d", target]);
      if ((await proc.exited) !== 0) throw new Error("unzip failed");
      await Bun.write(join(target, ".unzipped"), new Date().toISOString());
      console.log(`  unzipped into ${target}`);
    }
  },
  cnf: async (dir) => {
    const zip = join(dir, "cnf-fcen-csv.zip");
    await download(
      "https://www.canada.ca/content/dam/hc-sc/migration/hc-sc/fn-an/alt_formats/zip/nutrition/fiche-nutri-data/cnf-fcen-csv.zip",
      zip,
    );
    await unzip(zip, join(dir, "csv"));
  },
  cofid: async (dir) => {
    await download(
      "https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx",
      join(dir, "cofid-2021.xlsx"),
    );
  },
  ciqual: async (dir) => {
    const record = "https://zenodo.org/api/records/17550133/files";
    for (const file of [
      "alim_2025_11_03.xml",
      "alim_grp_2025_11_03.xml",
      "compo_2025_11_03.xml",
      "const_2025_11_03.xml",
    ]) {
      await download(`${record}/${file}/content`, join(dir, file));
    }
  },
  insa: async (dir) => {
    await download(
      "https://portfir.insa.min-saude.pt/wp-content/uploads/2025/11/insa_tca.xlsx",
      join(dir, "insa_tca.xlsx"),
    );
  },
  frida: async (dir) => {
    await download(
      "https://ndownloader.figshare.com/files/65016537",
      join(dir, "FCDB_6.1_Dataset.xlsx"),
    );
  },
  bls: async (dir) => {
    const zip = join(dir, "BLS_4_0_2025_DE.zip");
    if (args.force || !(await exists(zip))) {
      // The download link carries a per-visit token.
      const page = await (await fetchOk("https://blsdb.de/download")).text();
      const href = page
        .replace(/&#47;/g, "/")
        .replace(/&#95;/g, "_")
        .replace(/&#46;/g, ".")
        .match(/\/assets\/uploads\/BLS[^"']+\.zip\?token=[A-Z0-9-]+/)?.[0];
      if (!href)
        throw new Error("BLS download link not found on blsdb.de/download");
      await download(new URL(href, "https://blsdb.de").toString(), zip);
    }
    await unzip(zip, join(dir, "extracted"));
  },
  matvaretabellen: async (dir) => {
    for (const [lang, file] of [
      ["en", "foods.json"],
      ["nb", "foods.json"],
      ["en", "nutrients.json"],
      ["en", "food-groups.json"],
    ] as const) {
      await download(
        `https://www.matvaretabellen.no/api/${lang}/${file}`,
        join(dir, `${lang}-${file}`),
      );
    }
  },
  livsmedelsverket: async (dir) => {
    const path = join(dir, "livsmedel.json");
    if (!args.force && (await exists(path))) {
      console.log(`  have ${path}`);
      return;
    }
    const base = "https://dataportal.livsmedelsverket.se/livsmedel/api/v1";
    interface ListPage {
      _meta: { totalRecords: number };
      livsmedel: { nummer: number; namn: string }[];
    }
    const foods: { nummer: number; namn: string }[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await fetchJson<ListPage>(
        `${base}/livsmedel?offset=${offset}&limit=500&sprak=1`,
      );
      foods.push(...page.livsmedel);
      if (
        foods.length >= page._meta.totalRecords ||
        page.livsmedel.length === 0
      )
        break;
    }
    const english = new Map<number, string>();
    for (let offset = 0; ; offset += 500) {
      const page = await fetchJson<ListPage>(
        `${base}/livsmedel?offset=${offset}&limit=500&sprak=2`,
      );
      for (const food of page.livsmedel) english.set(food.nummer, food.namn);
      if (page.livsmedel.length < 500) break;
    }
    let done = 0;
    const detailed = await mapConcurrent(foods, 8, async (food) => {
      const [nutrients, classifications] = await Promise.all([
        fetchJson<unknown>(
          `${base}/livsmedel/${food.nummer}/naringsvarden?sprak=2`,
        ),
        fetchJson<unknown>(
          `${base}/livsmedel/${food.nummer}/klassificeringar?sprak=2`,
        ),
      ]);
      done += 1;
      if (done % 250 === 0)
        console.log(`  livsmedelsverket ${done}/${foods.length}`);
      return {
        ...food,
        namnEngelska: english.get(food.nummer) ?? null,
        nutrients,
        classifications,
      };
    });
    await Bun.write(path, JSON.stringify(detailed));
    console.log(`  got  ${path} (${detailed.length} foods)`);
  },
  swiss_fcdb: async (dir) => {
    await download(
      "https://naehrwertdaten.ch/wp-content/uploads/2026/07/Swiss_food_composition_database.xlsx",
      join(dir, "Swiss_food_composition_database.xlsx"),
    );
  },
  afcd: async (dir) => {
    const base = "https://www.foodstandards.gov.au/sites/default/files/2025-12";
    for (const name of [
      "Nutrient profiles",
      "Food Details",
      "Nutrient details",
    ]) {
      await download(
        `${base}/${encodeURIComponent(`AFCD Release 3 - ${name}`)}.xlsx`,
        join(dir, `AFCD Release 3 - ${name}.xlsx`),
      );
    }
  },
};

const main = async () => {
  const selected = Object.entries(tasks).filter(([name]) =>
    args.only ? args.only.includes(name) : !optIn.has(name),
  );
  const failures: string[] = [];

  for (const [name, task] of selected) {
    const dir = join(ROOT, name);
    await mkdir(dir, { recursive: true });
    console.log(`${name}`);
    try {
      await task(dir);
    } catch (error) {
      failures.push(name);
      console.error(
        `  FAILED ${name}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  console.log(
    `\n${selected.length - failures.length}/${selected.length} sources ready`,
  );
  for (const name of await readdir(ROOT)) console.log(`  ${name}`);
  if (failures.length) process.exitCode = 1;
};

await main();
