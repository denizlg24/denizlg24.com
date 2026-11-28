import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { altJson } from "../http";
import { AltUnavailable } from "../types";
import type { Legislator } from "./match";

const URL =
  "https://unitedstates.github.io/congress-legislators/legislators-current.json";

const raw = z.array(
  z.object({
    id: z.object({ bioguide: z.string() }),
    name: z.object({
      first: z.string(),
      last: z.string(),
      nickname: z.string().optional(),
      official_full: z.string().optional(),
    }),
    terms: z
      .array(
        z.object({
          type: z.enum(["rep", "sen"]),
          state: z.string(),
          party: z.string().optional(),
          district: z.number().optional(),
          url: z.string().optional(),
        }),
      )
      .min(1),
  }),
);

const stored = z.array(
  z.object({
    bioguide: z.string(),
    name: z.string(),
    party: z.string(),
    state: z.string(),
    chamber: z.enum(["house", "senate"]),
    district: z.number().nullable(),
    url: z.string().nullable(),
    first: z.string(),
    last: z.string(),
    nickname: z.string().nullable(),
  }),
);

export async function legislators() {
  const entry = await cached({
    source: "congress.legislators",
    key: "current",
    ttlMs: 12 * 3_600_000,
    schema: stored,
    load: async (): Promise<Legislator[]> => {
      const parsed = raw.safeParse(
        await altJson("congress-legislators", URL, {
          timeoutMs: 30_000,
          maxBytes: 10_000_000,
        }),
      );
      if (!parsed.success)
        throw new AltUnavailable("congress-legislators changed shape.");
      return parsed.data.map((person) => {
        const term = person.terms[person.terms.length - 1];
        return {
          bioguide: person.id.bioguide,
          name:
            person.name.official_full ??
            `${person.name.first} ${person.name.last}`,
          party: term.party ?? "Independent",
          state: term.state,
          chamber: term.type === "sen" ? "senate" : "house",
          district: term.district ?? null,
          url: term.url ?? null,
          first: person.name.first,
          last: person.name.last,
          nickname: person.name.nickname ?? null,
        };
      });
    },
  });
  return entry;
}
