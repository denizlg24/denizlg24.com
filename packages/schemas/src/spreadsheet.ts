import { z } from "zod";

export const spreadsheetSchema = z.object({
  _id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  pinataHash: z.string(),
  pinataFileId: z.string().optional(),
  pinataUrl: z.string(),
  sizeBytes: z.number(),
  sheetCount: z.number(),
  rowCount: z.number(),
  colCount: z.number(),
  lastOpenedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ISpreadsheet = z.infer<typeof spreadsheetSchema>;

export const fortuneSheetCellValueSchema = z.object({
  v: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
  m: z.string().optional(),
  ct: z.object({ fa: z.string().optional(), t: z.string().optional() }).optional(),
  bg: z.string().optional(),
  fc: z.string().optional(),
  ff: z.union([z.string(), z.number()]).optional(),
  fs: z.number().optional(),
  bl: z.number().optional(),
  it: z.number().optional(),
  cl: z.number().optional(),
  un: z.number().optional(),
  ht: z.number().optional(),
  vt: z.number().optional(),
  tb: z.string().optional(),
  mc: z
    .object({
      r: z.number(),
      c: z.number(),
      rs: z.number().optional(),
      cs: z.number().optional(),
    })
    .optional(),
});
export type FortuneSheetCellValue = z.infer<typeof fortuneSheetCellValueSchema>;

export const fortuneSheetCellDataSchema = z.object({
  r: z.number(),
  c: z.number(),
  v: fortuneSheetCellValueSchema.nullable(),
});
export type FortuneSheetCellData = z.infer<typeof fortuneSheetCellDataSchema>;

export const fortuneSheetSchema = z.object({
  name: z.string(),
  celldata: z.array(fortuneSheetCellDataSchema).optional(),
  row: z.number().optional(),
  column: z.number().optional(),
  order: z.number().optional(),
  status: z.number().optional(),
  config: z
    .object({
      merge: z
        .record(
          z.string(),
          z.object({
            r: z.number(),
            c: z.number(),
            rs: z.number(),
            cs: z.number(),
          }),
        )
        .optional(),
      rowlen: z.record(z.string(), z.number()).optional(),
      columnlen: z.record(z.string(), z.number()).optional(),
      rowhidden: z.record(z.string(), z.number()).optional(),
      colhidden: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
});
export type FortuneSheet = z.infer<typeof fortuneSheetSchema>;

export const fortuneSheetBookSchema = z.array(fortuneSheetSchema);
export type FortuneSheetBook = z.infer<typeof fortuneSheetBookSchema>;
