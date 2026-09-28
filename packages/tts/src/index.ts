export const DEFAULT_TTS_MODEL = "google/gemini-3.8-flash-lite-tts";
export const DEFAULT_TTS_VOICE = "Kore";

export const TTS_MODELS = [
  "google/gemini-3.8-flash-lite-tts",
  "google/gemini-3.8-flash-tts",
  "openai/tts-1",
  "openai/tts-1-hd",
] as const;

export const GOOGLE_VOICES = ["Kore", "Puck", "Zephyr", "Charon"] as const;
export const OPENAI_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export function voicesForModel(model: string): readonly string[] {
  return model.startsWith("openai/") ? OPENAI_VOICES : GOOGLE_VOICES;
}

export function defaultVoiceForModel(model: string): string {
  return model.startsWith("openai/") ? "alloy" : DEFAULT_TTS_VOICE;
}

/** Keep each Gateway request comfortably below model input limits. */
export function splitSpeechText(text: string, maxLength = 2_000): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const sentence = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
    );
    const space = window.lastIndexOf(" ");
    const cut =
      sentence > maxLength / 2
        ? sentence + 1
        : space > maxLength / 2
          ? space
          : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
