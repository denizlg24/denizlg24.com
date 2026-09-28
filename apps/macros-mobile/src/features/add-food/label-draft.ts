import type {
  MacrosVisionLabelFormat,
  MacrosVisionLabelResponse,
} from "@repo/schemas/macros";

export interface LabelDraft {
  label: MacrosVisionLabelResponse;
  labelFormat: MacrosVisionLabelFormat;
}

let pending: LabelDraft | null = null;

/** Hands a parsed label from the camera to the form. */
export function putLabelDraft(draft: LabelDraft) {
  pending = draft;
}

// Reading and clearing are separate so a state initializer that React runs
// twice sees the same draft both times; the form clears it once mounted, and
// a form opened later starts empty rather than with an old label's values.
export function readLabelDraft(): LabelDraft | null {
  return pending;
}

export function clearLabelDraft() {
  pending = null;
}
