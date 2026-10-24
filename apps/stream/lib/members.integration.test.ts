import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const url = process.env.STREAM_TEST_DATABASE_URL;
const integration = test.skipIf(!url);
const schema = `stream_test_${crypto.randomUUID().replaceAll("-", "")}`;
let admin: Client;
let members: typeof import("./members");
let catalog: typeof import("./catalog");
let database: typeof import("../db");
beforeAll(async () => {
  if (!url) return;
  mock.module("server-only", () => ({}));
  admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const isolated = new URL(url);
  isolated.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.STREAM_DATABASE_URL = isolated.toString();
  const migration = (
    await readFile(new URL("../drizzle/0000_init.sql", import.meta.url), "utf8")
  ).replaceAll('"public".', `"${schema}".`);
  const setup = new Client({ connectionString: isolated.toString() });
  await setup.connect();
  try {
    await setup.query(migration);
  } finally {
    await setup.end();
  }
  database = await import("../db");
  members = await import("./members");
  catalog = await import("./catalog");
});
afterAll(async () => {
  if (!admin) return;
  if (database) await database.db.$client.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
integration(
  "all family accounts share profiles with household limits and membership checks",
  async () => {
    await members.createMember("alice", "Alice", "ember");
    await members.createMember("bob", "Bob", "tide");
    const initial = await members.listProfiles("alice");
    expect(initial).toHaveLength(1);
    expect(await members.listProfiles("bob")).toEqual(initial);
    expect(await members.listProfiles("stranger")).toEqual([]);
    expect(await members.ownedProfile("bob", initial[0]!.id)).not.toBeNull();
    expect(await members.ownedProfile("stranger", initial[0]!.id)).toBeNull();
    for (let i = 0; i < 4; i++)
      await members.createProfile("alice", {
        name: `Person ${i}`,
        color: "ember",
        kids: false,
        showIndianCinema: false,
        layout: "studio",
        favoriteGenres: [],
      });
    await expect(
      members.createProfile("bob", {
        name: "Extra",
        color: "tide",
        kids: false,
        showIndianCinema: false,
        layout: "studio",
        favoriteGenres: [],
      }),
    ).rejects.toBeInstanceOf(members.ProfileLimitError);
    const all = await members.listProfiles("bob");
    expect(
      (await members.updateProfile("bob", all[1]!.id, { name: "Shared" }))
        ?.name,
    ).toBe("Shared");
    for (const profile of all.slice(1))
      expect(await members.deleteProfile("bob", profile.id)).toBe(true);
    await expect(
      members.deleteProfile("bob", initial[0]!.id),
    ).rejects.toBeInstanceOf(members.LastProfileError);
  },
);
integration(
  "Continue Watching excludes accidental starts and completed titles",
  async () => {
    const { titles } = await import("../db/schema");
    await database.db
      .insert(titles)
      .values({ id: "tt1234567", type: "movie", title: "Resume me" });
    const [profile] = await members.listProfiles("alice");
    const input = { titleId: "tt1234567", episodeId: null, durationS: 1000 };
    await catalog.saveProgress(profile!.id, { ...input, positionS: 5 });
    expect(await catalog.continueWatching(profile!.id)).toHaveLength(0);
    await catalog.saveProgress(profile!.id, { ...input, positionS: 300 });
    expect(
      (await catalog.continueWatching(profile!.id))[0]?.progress.positionS,
    ).toBe(300);
    await catalog.saveProgress(profile!.id, { ...input, positionS: 990 });
    expect(await catalog.continueWatching(profile!.id)).toHaveLength(0);
  },
);

integration(
  "actor filmography and combined genre filters use exact catalogue matches",
  async () => {
    const { titleQuerySchema } = await import("@repo/schemas/stream");
    const { titles } = await import("../db/schema");
    const everyone = { kids: false, hideIndianCinema: false };
    await database.db.insert(titles).values({
      id: "tt1234568",
      type: "movie",
      title: "A cast match",
      genres: ["Comedy", "Thriller"],
      cast: [{ name: "O’Neil", character: null, profilePath: null }],
    });
    expect(
      (
        await catalog.queryTitles(
          titleQuerySchema.parse({
            actor: "O’Neil",
            genres: ["Comedy", "Thriller"],
          }),
          everyone,
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await catalog.queryTitles(
          titleQuerySchema.parse({ actor: "O’Neil", genres: ["Drama"] }),
          everyone,
        )
      ).total,
    ).toBe(0);
    expect(
      (
        await catalog.queryTitles(
          titleQuerySchema.parse({ actor: "' OR true --" }),
          everyone,
        )
      ).total,
    ).toBe(0);
  },
);

integration(
  "Indian-language titles stay hidden unless the whole sofa allows them",
  async () => {
    const { titleQuerySchema } = await import("@repo/schemas/stream");
    const { titles } = await import("../db/schema");
    const { audienceRules } = await import("./audience-rules");
    await database.db.insert(titles).values([
      {
        id: "tt2000001",
        type: "movie",
        title: "Lagaan match",
        originalLanguage: "hi",
      },
      {
        id: "tt2000002",
        type: "movie",
        title: "Lagaan match too",
        originalLanguage: "en",
      },
      { id: "tt2000003", type: "movie", title: "Lagaan match unenriched" },
    ]);
    const query = titleQuerySchema.parse({ q: "Lagaan match" });
    const found = async (rules: ReturnType<typeof audienceRules>) =>
      (await catalog.queryTitles(query, rules)).titles.map((t) => t.id).sort();
    const opted = { kids: false, showIndianCinema: true };
    const unset = { kids: false, showIndianCinema: false };
    expect(await found(audienceRules([unset]))).toEqual([
      "tt2000002",
      "tt2000003",
    ]);
    expect(await found(audienceRules([opted, unset]))).toEqual([
      "tt2000002",
      "tt2000003",
    ]);
    expect(await found(audienceRules([opted]))).toEqual([
      "tt2000001",
      "tt2000002",
      "tt2000003",
    ]);
  },
);

integration(
  "embed viewing keeps selections and completion without fabricating playback time",
  async () => {
    const { titles, episodes } = await import("../db/schema");
    await database.db
      .insert(titles)
      .values({ id: "tt7654321", type: "series", title: "Episode progress" });
    await database.db.insert(episodes).values([
      { id: "tt7654322", seriesId: "tt7654321", season: 1, episode: 1 },
      { id: "tt7654323", seriesId: "tt7654321", season: 2, episode: 1 },
    ]);
    const [profile] = await members.listProfiles("alice");
    const selection = {
      titleId: "tt7654321",
      episodeId: "tt7654322",
      completed: false,
    };
    const started = await catalog.saveViewing(profile!.id, selection);
    expect(started.positionS).toBe(0);
    expect(started.durationS).toBe(0);
    expect(
      (await catalog.continueWatching(profile!.id)).some(
        (item) => item.title.id === selection.titleId,
      ),
    ).toBe(true);
    await catalog.saveProgress(profile!.id, {
      ...selection,
      positionS: 300,
      durationS: 3000,
    });
    expect((await catalog.saveViewing(profile!.id, selection)).positionS).toBe(
      300,
    );
    const moved = await catalog.saveViewing(profile!.id, {
      ...selection,
      episodeId: "tt7654323",
    });
    expect(moved.positionS).toBe(0);
    expect(moved.durationS).toBe(0);
    const finished = await catalog.saveViewing(profile!.id, {
      ...selection,
      episodeId: "tt7654323",
      completed: true,
    });
    expect(finished.completed).toBe(true);
    expect(finished.positionS).toBe(0);
    expect(finished.durationS).toBe(0);
    const { validViewing } = await import("./viewing");
    expect(await validViewing(selection)).toBe(true);
    expect(await validViewing({ ...selection, episodeId: "tt1234567" })).toBe(
      false,
    );
    expect(await validViewing({ ...selection, episodeId: null })).toBe(false);
  },
);
