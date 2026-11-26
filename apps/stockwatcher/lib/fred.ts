import "server-only";

export type MacroObservation = { date: string; value: number };

export type MacroSeries = {
  id: string;
  title: string | null;
  frequency: string | null;
  units: string | null;
  observations: MacroObservation[];
  source: "FRED API" | "FRED";
};

const SERIES_ID = /^[A-Za-z0-9_.-]{1,40}$/;
const TTL_MS = 3_600_000;
const MAX_CACHED_OBSERVATIONS = 400_000;

const cache = new Map<
  string,
  { at: number; series: MacroSeries; titled: boolean }
>();
let cachedObservations = 0;

const apiKey = () => process.env.FRED_API_KEY?.trim() || null;

function parseValue(raw: string) {
  if (raw === "" || raw === ".") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function fromCsv(id: string) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", id);
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404 || response.status === 400)
    throw new Error(`FRED has no series "${id}".`);
  if (!response.ok) throw new Error(`FRED returned HTTP ${response.status}.`);
  const lines = (await response.text()).trim().split("\n").slice(1);
  const observations: MacroObservation[] = [];
  for (const line of lines) {
    const [date, raw] = line.trim().split(",");
    const value = raw === undefined ? null : parseValue(raw);
    if (date && value !== null) observations.push({ date, value });
  }
  return observations;
}

async function csvTitle(id: string) {
  const response = await fetch(
    `https://fred.stlouisfed.org/series/${encodeURIComponent(id)}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  if (!response?.ok) return null;
  const html = await response.text();
  const match = /<title>([^<]*?)\s*\([^()<]*\)\s*\|\s*FRED/i.exec(html);
  return match ? match[1].replaceAll("&amp;", "&").trim() : null;
}

type ApiSeries = {
  seriess?: Array<{
    title: string;
    frequency: string;
    units: string;
  }>;
};
type ApiObservations = {
  observations?: Array<{ date: string; value: string }>;
};

async function fromApi(id: string, key: string) {
  const query = new URLSearchParams({
    series_id: id,
    api_key: key,
    file_type: "json",
  });
  const meta = await fetch(`https://api.stlouisfed.org/fred/series?${query}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (meta.status === 400 || meta.status === 404)
    throw new Error(`FRED has no series "${id}".`);
  if (!meta.ok) throw new Error(`FRED returned HTTP ${meta.status}.`);
  const info: ApiSeries = await meta.json();
  const response = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?${query}`,
    { cache: "no-store", signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) throw new Error(`FRED returned HTTP ${response.status}.`);
  const body: ApiObservations = await response.json();
  const observations: MacroObservation[] = [];
  for (const row of body.observations ?? []) {
    const value = parseValue(row.value);
    if (value !== null) observations.push({ date: row.date, value });
  }
  const detail = info.seriess?.[0];
  return {
    observations,
    title: detail?.title ?? null,
    frequency: detail?.frequency ?? null,
    units: detail?.units ?? null,
  };
}

function inferFrequency(observations: MacroObservation[]) {
  if (observations.length < 3) return null;
  const tail = observations.slice(-6);
  const gaps = tail
    .slice(1)
    .map(
      (item, index) =>
        (Date.parse(item.date) - Date.parse(tail[index].date)) / 86_400_000,
    )
    .toSorted((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 4) return "Daily";
  if (median <= 10) return "Weekly";
  if (median <= 40) return "Monthly";
  if (median <= 100) return "Quarterly";
  return "Annual";
}

export async function fredSeries(
  rawId: string,
  from?: string,
  withTitle = false,
): Promise<MacroSeries> {
  const id = rawId.trim().toUpperCase();
  if (!SERIES_ID.test(id))
    throw new Error(`"${rawId}" is not a FRED series id.`);
  const hit = cache.get(id);
  const fresh =
    hit && Date.now() - hit.at < TTL_MS && (hit.titled || !withTitle);
  const series = fresh ? hit.series : await load(id, withTitle);
  return from
    ? {
        ...series,
        observations: series.observations.filter((item) => item.date >= from),
      }
    : series;
}

async function load(id: string, withTitle: boolean): Promise<MacroSeries> {
  const token = apiKey();
  const series: MacroSeries = token
    ? { id, source: "FRED API", ...(await fromApi(id, token)) }
    : await (async () => {
        const [observations, title] = await Promise.all([
          fromCsv(id),
          withTitle ? csvTitle(id) : Promise.resolve(null),
        ]);
        return {
          id,
          title,
          frequency: inferFrequency(observations),
          units: null,
          observations,
          source: "FRED" as const,
        };
      })();
  const previous = cache.get(id);
  if (previous) cachedObservations -= previous.series.observations.length;
  cache.delete(id);
  cache.set(id, {
    at: Date.now(),
    series,
    titled: Boolean(token) || withTitle,
  });
  cachedObservations += series.observations.length;
  for (const [oldest, entry] of cache) {
    if (cachedObservations <= MAX_CACHED_OBSERVATIONS) break;
    cachedObservations -= entry.series.observations.length;
    cache.delete(oldest);
  }
  return series;
}
