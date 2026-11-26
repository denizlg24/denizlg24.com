import "server-only";
import { inflateRawSync } from "node:zlib";

const BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp";
const TTL_MS = 24 * 3_600_000;

export const factorKeys = ["mkt", "smb", "hml", "rmw", "cma", "mom"] as const;
export type FactorKey = (typeof factorKeys)[number];
export type FactorRow = Record<FactorKey | "rf", number>;
export type FactorData = {
  rows: Map<number, FactorRow>;
  days: number[];
  first: number;
  last: number;
};

const dayOf = (stamp: string) =>
  Math.floor(
    Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
    ) / 86_400_000,
  );

/** Reads the single file inside a zip using the central directory, which stays correct when local headers carry no sizes. */
export function unzipFirst(buffer: Buffer): string {
  let eocd = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65_557);
    i--
  )
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("The factor archive is malformed.");
  const entry = buffer.readUInt32LE(eocd + 16);
  if (buffer.readUInt32LE(entry) !== 0x02014b50)
    throw new Error("The factor archive is malformed.");
  const method = buffer.readUInt16LE(entry + 10);
  const compressed = buffer.readUInt32LE(entry + 20);
  const local = buffer.readUInt32LE(entry + 42);
  if (buffer.readUInt32LE(local) !== 0x04034b50)
    throw new Error("The factor archive is malformed.");
  const start =
    local +
    30 +
    buffer.readUInt16LE(local + 26) +
    buffer.readUInt16LE(local + 28);
  const data = buffer.subarray(start, start + compressed);
  if (method === 0) return data.toString("utf8");
  if (method !== 8)
    throw new Error("The factor archive uses an unsupported compression.");
  return inflateRawSync(data).toString("utf8");
}

function parseCsv(text: string) {
  const out = new Map<number, number[]>();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (!/^\d{8}$/.test(cells[0])) continue;
    const values = cells.slice(1).map(Number);
    if (values.some((value) => !Number.isFinite(value) || value <= -99))
      continue;
    out.set(dayOf(cells[0]), values);
  }
  return out;
}

async function download(file: string) {
  const response = await fetch(`${BASE}/${file}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(
      `Ken French data library returned HTTP ${response.status}.`,
    );
  return unzipFirst(Buffer.from(await response.arrayBuffer()));
}

async function load(): Promise<FactorData> {
  const [five, momentum] = await Promise.all([
    download("F-F_Research_Data_5_Factors_2x3_daily_CSV.zip").then(parseCsv),
    download("F-F_Momentum_Factor_daily_CSV.zip").then(parseCsv),
  ]);
  const rows = new Map<number, FactorRow>();
  for (const [day, [mkt, smb, hml, rmw, cma, rf]] of five) {
    const mom = momentum.get(day)?.[0];
    if (mom == null) continue;
    rows.set(day, {
      mkt: mkt / 100,
      smb: smb / 100,
      hml: hml / 100,
      rmw: rmw / 100,
      cma: cma / 100,
      mom: mom / 100,
      rf: rf / 100,
    });
  }
  const days = [...rows.keys()].sort((a, b) => a - b);
  if (days.length < 250) throw new Error("The factor data could not be read.");
  return { rows, days, first: days[0], last: days.at(-1)! };
}

let cached: { at: number; data: Promise<FactorData> } | null = null;

export function famaFrench(): Promise<FactorData> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const data = load();
  cached = { at: Date.now(), data };
  data.catch(() => {
    if (cached?.data === data) cached = null;
  });
  return data;
}
