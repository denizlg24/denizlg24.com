import { z } from "zod";

export const relationKinds = [
  "customer",
  "supplier",
  "partner",
  "competitor",
  "mention",
] as const;
export type RelationKind = (typeof relationKinds)[number];

export const filingSchema = z.object({
  cik: z.string(),
  name: z.string(),
  ticker: z.string().nullable(),
  form: z.string(),
  filed: z.string(),
  accession: z.string(),
  url: z.string(),
});
export type Filing = z.infer<typeof filingSchema>;

export const linkSchema = z.object({
  counterparty: z.string(),
  ticker: z.string().nullable(),
  /** The counterparty's role relative to the company being viewed. */
  role: z.enum(relationKinds),
  /** Fraction of revenue, when the filing states one. */
  share: z.number().nullable(),
  /** Whose revenue `share` measures: the viewed company's or the counterparty's. */
  shareOf: z.enum(["company", "counterparty"]),
  period: z.string().nullable(),
  quote: z.string(),
  source: filingSchema,
});
export type Link = z.infer<typeof linkSchema>;
export const cachedLinks = z.array(linkSchema);
export const cachedVerification = z.object({ link: linkSchema.nullable() });

export type OwnDisclosure = { filing: Filing; links: Link[] };
export type Candidate = Filing & { query: "customers" | "suppliers" };
export type Verified = { candidate: Candidate; link: Link | null };

export const extractionSchema = z.object({
  relationships: z
    .array(
      z.object({
        counterparty: z
          .string()
          .describe(
            "Company name as written, or 'Unnamed customer'/'Unnamed customers' when not named",
          ),
        relation: z
          .enum(["customer", "supplier", "partner"])
          .describe("The counterparty's role toward the filer"),
        share: z
          .number()
          .min(0)
          .max(1)
          .nullable()
          .describe("Fraction of the filer's revenue, e.g. 0.12; null if not stated"),
        period: z.string().nullable().describe("Fiscal period the figure covers"),
        quote: z
          .string()
          .describe("Exact sentence copied verbatim from the excerpt that supports this"),
      }),
    )
    .max(25),
});

export const verificationSchema = z.object({
  relation: z
    .enum(["supplier", "customer", "partner", "competitor", "mention"])
    .describe(
      "The FILER's role toward the TARGET: supplier = filer sells to target; customer = filer buys from target; mention = no commercial relationship stated",
    ),
  share: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .describe("Fraction of the filer's revenue from the target, if stated"),
  period: z.string().nullable(),
  quote: z
    .string()
    .describe("Exact sentence copied verbatim from the excerpts; empty if mention"),
});
