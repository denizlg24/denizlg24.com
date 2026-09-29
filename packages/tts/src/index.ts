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

export const MAX_SPEECH_CHUNK = 2_000;

/**
 * Target size of each successive request. The first is about one sentence so
 * audio starts in the time it takes to synthesise it; later ones grow because
 * they are generated while earlier audio plays, and fewer requests means fewer
 * seams in the voice.
 */
export const SPEECH_CHUNK_TARGETS = [160, 400, 900, 1_500] as const;

/** Keep each Gateway request comfortably below model input limits. */
export function splitSpeechText(
  text: string,
  maxLength = MAX_SPEECH_CHUNK,
): string[] {
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

const SENTENCE_END = /[.!?…]["'”’)\]]*\s|\n/g;
const CLAUSE_END = /[,;:—–]\s/g;

function lastBoundary(window: string, pattern: RegExp, floor: number): number {
  let cut = -1;
  for (const match of window.matchAll(pattern)) {
    const end = match.index + match[0].length;
    if (end > floor) cut = end;
  }
  return cut;
}

/** Where to end a chunk of at most `target` characters: a sentence, else a clause, else a word. */
function cutPoint(text: string, target: number): number {
  const window = text.slice(0, target + 1);
  const floor = Math.floor(target / 3);
  const sentence = lastBoundary(window, SENTENCE_END, floor);
  if (sentence > 0) return sentence;
  const clause = lastBoundary(window, CLAUSE_END, floor);
  if (clause > 0) return clause;
  const space = window.lastIndexOf(" ");
  return space > floor ? space : target;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Re-cuts arriving text (a whole note, pages of a PDF, a streamed reply) into
 * speech requests that grow along `SPEECH_CHUNK_TARGETS`, emitting each as
 * soon as enough text has arrived to fill it.
 */
export async function* speechChunks(
  parts: AsyncIterable<string> | Iterable<string>,
  targets: readonly number[] = SPEECH_CHUNK_TARGETS,
): AsyncGenerator<string> {
  let buffer = "";
  let index = 0;
  const target = () =>
    Math.min(
      MAX_SPEECH_CHUNK,
      targets[Math.min(index, targets.length - 1)] ?? MAX_SPEECH_CHUNK,
    );
  for await (const part of parts) {
    buffer += `${part.replace(/[ \t\r\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n")}\n`;
    buffer = buffer.replace(/^\s+/, "");
    while (buffer.length > target()) {
      const cut = cutPoint(buffer, target());
      const chunk = collapse(buffer.slice(0, cut));
      buffer = buffer.slice(cut).replace(/^\s+/, "");
      if (chunk) {
        index += 1;
        yield chunk;
      }
    }
  }
  const rest = collapse(buffer);
  if (rest) yield* splitSpeechText(rest);
}
