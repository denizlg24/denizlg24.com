import { z } from "zod";

export const SPEECH_NARRATE_MAX_CHARS = 12_000;

export const speechNarrateRequestSchema = z.object({
  kind: z.enum(["code", "table", "math"]),
  text: z.string().trim().min(1).max(SPEECH_NARRATE_MAX_CHARS),
  before: z.string().max(1_000).default(""),
});
export type SpeechNarrateRequest = z.infer<typeof speechNarrateRequestSchema>;

export const speechNarrateResponseSchema = z.object({ spoken: z.string() });
export type SpeechNarrateResponse = z.infer<typeof speechNarrateResponseSchema>;
