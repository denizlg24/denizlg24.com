import { z } from "zod";
import { chartSchema, chartSpecSchema } from "./chart";

export const maxSections = 40;
export const maxSlides = 40;
export const maxDocBytes = 1_000_000;

const text = (max: number) => z.string().trim().min(1).max(max);
const cell = z.union([z.string().max(400), z.number().finite(), z.null()]);

export const tableSchema = z
  .object({
    columns: z.array(text(60)).min(1).max(12),
    rows: z.array(z.array(cell).max(12)).min(1).max(200),
    align: z
      .array(z.enum(["left", "right"]))
      .max(12)
      .optional()
      .describe("Per column; right-align numeric columns"),
    caption: z.string().trim().max(240).optional(),
  })
  .refine(
    (table) => table.rows.every((row) => row.length === table.columns.length),
    { message: "Every row needs one cell per column", path: ["rows"] },
  );
export type Table = z.infer<typeof tableSchema>;

export const calloutSchema = z.object({
  tone: z.enum(["note", "positive", "negative", "risk"]).default("note"),
  title: z.string().trim().max(80).optional(),
  text: text(1200),
});
export type Callout = z.infer<typeof calloutSchema>;

const date = z.iso.date();

function reportShape<C extends z.ZodType>(chart: C) {
  return z.object({
    title: text(160),
    subtitle: z.string().trim().max(400).optional(),
    author: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe("Byline, e.g. 'Prepared by J. Smith'"),
    date: date.describe("Publication date, YYYY-MM-DD"),
    sections: z
      .array(
        z.object({
          heading: text(140),
          markdown: z
            .string()
            .max(20_000)
            .default("")
            .describe("GitHub-flavoured markdown body; no raw HTML"),
          chart: chart.optional(),
          table: tableSchema.optional(),
          callout: calloutSchema.optional(),
        }),
      )
      .min(1)
      .max(maxSections),
    sources: z
      .array(text(240))
      .max(30)
      .optional()
      .describe("Sources and as-of times cited in the report"),
  });
}

export const slideLayouts = [
  "title",
  "section",
  "bullets",
  "chart",
  "chart-bullets",
  "table",
  "quote",
] as const;
export type SlideLayout = (typeof slideLayouts)[number];

function deckShape<C extends z.ZodType>(chart: C) {
  return z.object({
    title: text(160),
    subtitle: z.string().trim().max(400).optional(),
    author: z.string().trim().max(120).optional(),
    date: date,
    theme: z.enum(["light", "dark"]).default("light"),
    slides: z
      .array(
        z.object({
          layout: z
            .enum(slideLayouts)
            .describe(
              "quote: title is the quotation, subtitle the attribution",
            ),
          title: text(240),
          subtitle: z.string().trim().max(300).optional(),
          bullets: z.array(text(300)).max(8).optional(),
          chart: chart.optional(),
          table: tableSchema.optional(),
          notes: z
            .string()
            .trim()
            .max(4000)
            .optional()
            .describe("Presenter notes"),
        }),
      )
      .min(1)
      .max(maxSlides),
    sources: z.array(text(240)).max(30).optional(),
  });
}

export const reportSchema = reportShape(chartSchema);
export const reportInputSchema = reportShape(chartSpecSchema);
export const deckSchema = deckShape(chartSchema);
export const deckInputSchema = deckShape(chartSpecSchema);

export type Report = z.infer<typeof reportSchema>;
export type ReportInput = z.infer<typeof reportInputSchema>;
export type Deck = z.infer<typeof deckSchema>;
export type DeckInput = z.infer<typeof deckInputSchema>;
export type Section = Report["sections"][number];
export type Slide = Deck["slides"][number];

export type DocKind = "report" | "deck";
export type StoredDoc =
  | { kind: "report"; doc: Report }
  | { kind: "deck"; doc: Deck };

export type ReportSummary = {
  id: string;
  kind: DocKind;
  title: string;
  shared: boolean;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportRecord = ReportSummary & StoredDoc;

export const sharePath = (kind: DocKind, token: string) =>
  `/${kind === "deck" ? "d" : "r"}/${token}`;
export const previewPath = (id: string) => `/reports/${id}`;

export type PublishedDoc = {
  id: string;
  kind: DocKind;
  title: string;
  previewUrl: string;
  shareUrl: string | null;
};
