import OpenAI from "openai";
import { LlmConfigurationError, LlmTransportError } from "@/lib/llm-errors";

/**
 * The second place in the codebase that talks to a provider outside the Vercel
 * AI Gateway, alongside `cohere-embeddings.ts`.
 *
 * The Gateway cannot carry this call: it exposes no speech-to-text route at
 * all, and its catalog lists only language and embedding models. Speech has to
 * reach OpenAI directly or not happen. App code still calls `llm-service`;
 * this module is the sole place an OpenAI client is constructed.
 */

/** Normalised across OpenAI's two billing shapes for transcription. */
export interface TranscriptionUsage {
  /** Audio tokens billed, when the model bills by token. */
  audioInputTokens: number;
  /** Text tokens billed on the way in (prompt), when billed by token. */
  textInputTokens: number;
  /** Text tokens generated, when billed by token. */
  textOutputTokens: number;
  /** Audio length, when the model bills by minute instead. */
  seconds?: number;
}

export interface TranscriptionResponse {
  text: string;
  language?: string;
  usage: TranscriptionUsage;
}

const EMPTY_USAGE: TranscriptionUsage = {
  audioInputTokens: 0,
  textInputTokens: 0,
  textOutputTokens: 0,
};

export async function requestTranscription({
  file,
  model,
  signal,
}: {
  file: File;
  model: string;
  signal?: AbortSignal;
}): Promise<TranscriptionResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new LlmConfigurationError(
      "OPENAI_API_KEY is not configured; transcription is unavailable",
    );
  }

  let result: Awaited<ReturnType<OpenAI["audio"]["transcriptions"]["create"]>>;
  try {
    result = await new OpenAI({ apiKey }).audio.transcriptions.create(
      { file, model, response_format: "json" },
      { ...(signal ? { signal } : {}) },
    );
  } catch (error) {
    throw new LlmTransportError(
      `Transcription request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error instanceof OpenAI.APIError ? error.status : undefined,
    );
  }

  if (typeof result.text !== "string") {
    throw new LlmTransportError("Transcription response contained no text");
  }

  const usage = result.usage;
  return {
    text: result.text.trim(),
    language: result.languages?.[0]?.code,
    usage:
      usage?.type === "tokens"
        ? {
            audioInputTokens: usage.input_token_details?.audio_tokens ?? 0,
            // Older responses report only a combined input count; attribute the
            // remainder to text so the two never double-count the same tokens.
            textInputTokens:
              usage.input_token_details?.text_tokens ??
              Math.max(
                0,
                usage.input_tokens -
                  (usage.input_token_details?.audio_tokens ?? 0),
              ),
            textOutputTokens: usage.output_tokens,
          }
        : usage?.type === "duration"
          ? { ...EMPTY_USAGE, seconds: usage.seconds }
          : EMPTY_USAGE,
  };
}
