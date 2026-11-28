import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { altJson } from "../http";
import { AltUnavailable } from "../types";

const resultSchema = z.object({
  ticker: z.string().nullable(),
  name: z.string().nullable(),
});
type Mapped = z.infer<typeof resultSchema>;

const responseSchema = z.array(
  z.object({
    data: z
      .array(
        z.object({
          ticker: z.string().nullable().optional(),
          name: z.string().nullable().optional(),
          exchCode: z.string().nullable().optional(),
          securityType2: z.string().nullable().optional(),
        }),
      )
      .optional(),
    warning: z.string().optional(),
    error: z.string().optional(),
  }),
);

const apiKey = () => process.env.OPENFIGI_API_KEY;
const batchSize = () => (apiKey() ? 100 : 10);

type Waiter = {
  resolve: (value: Mapped) => void;
  reject: (error: unknown) => void;
};
const waiting = new Map<string, Waiter[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = [...waiting.entries()].slice(0, batchSize());
  for (const [cusip] of batch) waiting.delete(cusip);
  if (waiting.size) timer = setTimeout(flush, apiKey() ? 250 : 2_500);
  try {
    const raw = await altJson(
      "OpenFIGI",
      "https://api.openfigi.com/v3/mapping",
      {
        method: "POST",
        body: JSON.stringify(
          batch.map(([cusip]) => ({ idType: "ID_CUSIP", idValue: cusip })),
        ),
        headers: {
          "Content-Type": "application/json",
          ...(apiKey() ? { "X-OPENFIGI-APIKEY": apiKey() as string } : {}),
        },
      },
    );
    const parsed = responseSchema.parse(raw);
    batch.forEach(([, waiters], index) => {
      const data = parsed[index]?.data ?? [];
      const best = data.find((item) => item.exchCode === "US") ?? data[0];
      const value: Mapped = {
        ticker: best?.ticker ?? null,
        name: best?.name ?? null,
      };
      for (const waiter of waiters) waiter.resolve(value);
    });
  } catch (error) {
    for (const [, waiters] of batch)
      for (const waiter of waiters)
        waiter.reject(
          error instanceof AltUnavailable
            ? error
            : new AltUnavailable("OpenFIGI is unavailable right now."),
        );
  }
}

function lookup(cusip: string): Promise<Mapped> {
  return new Promise((resolve, reject) => {
    const waiters = waiting.get(cusip) ?? [];
    waiters.push({ resolve, reject });
    waiting.set(cusip, waiters);
    timer ??= setTimeout(flush, 30);
  });
}

/** CUSIP to ticker and name through OpenFIGI, cached forever; failures leave the entry unresolved rather than failing the caller. */
export async function figiFor(cusip: string): Promise<Mapped | null> {
  try {
    return (
      await cached({
        source: "openfigi",
        key: cusip,
        ttlMs: Number.POSITIVE_INFINITY,
        schema: resultSchema,
        load: () => lookup(cusip),
      })
    ).value;
  } catch {
    return null;
  }
}

export async function tickersFor(
  cusips: string[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(cusips)];
  const mapped = await Promise.all(unique.map(figiFor));
  return new Map(
    unique.map((cusip, index) => [cusip, mapped[index]?.ticker ?? null]),
  );
}

/** OpenFIGI writes share classes as BRK/B; the app uses BRK-B. */
export const normaliseTicker = (ticker: string) =>
  ticker.toUpperCase().replace(/[/.]/g, "-");
