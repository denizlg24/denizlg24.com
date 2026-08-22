import {
  type MacrosVisionLabelResponse,
  macrosVisionLabelResponseSchema,
} from "@repo/schemas/macros";
import { z } from "zod";

const CREATE_FOOD_DRAFT_KEY = "macros.createFoodDraft";

const createFoodDraftSchema = z.object({
  barcode: z.string().nullable(),
  scannedLabel: macrosVisionLabelResponseSchema.nullable(),
  scannedLabelFormat: z.enum(["eu", "us"]),
});

export interface CreateFoodDraft {
  barcode: string | null;
  scannedLabel: MacrosVisionLabelResponse | null;
  scannedLabelFormat: "eu" | "us";
}

export function writeCreateFoodDraft(draft: CreateFoodDraft) {
  window.sessionStorage.setItem(CREATE_FOOD_DRAFT_KEY, JSON.stringify(draft));
}

export function takeCreateFoodDraft(): CreateFoodDraft | null {
  const raw = window.sessionStorage.getItem(CREATE_FOOD_DRAFT_KEY);
  window.sessionStorage.removeItem(CREATE_FOOD_DRAFT_KEY);
  if (!raw) return null;

  try {
    return createFoodDraftSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
