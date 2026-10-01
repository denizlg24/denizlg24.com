"use client";

import {
  SPEECH_NARRATE_MAX_CHARS,
  type SpeechNarrateResponse,
} from "@repo/schemas";
import {
  type SpeechAudio,
  type SpeechNarrator,
  useSpeechPlayer,
} from "@repo/tts/react";
import { useMemo } from "react";
import type { AdminClient } from "../client";

export function adminSpeechGenerator(client: AdminClient) {
  return async (text: string, signal: AbortSignal): Promise<SpeechAudio> => {
    const response = await client.raw("tts", {
      method: "POST",
      body: { text },
      signal,
    });
    return { blob: await response.blob() };
  };
}

/** A block longer than the route accepts is narrated from its head, which still says what it is. */
export function adminSpeechNarrator(client: AdminClient): SpeechNarrator {
  return async (segment, signal) => {
    const { spoken } = await client.post<SpeechNarrateResponse>(
      "tts/narrate",
      {
        kind: segment.kind,
        text: segment.text.slice(0, SPEECH_NARRATE_MAX_CHARS),
        before: segment.before,
      },
      { signal },
    );
    return spoken;
  };
}

/**
 * `narrate` is for markdown sources, where code, tables and math are
 * detectable; extracted PDF text and replies already written for speech
 * leave it off.
 */
export function useAdminSpeech(
  client: AdminClient,
  { narrate = false }: { narrate?: boolean } = {},
) {
  const generate = useMemo(() => adminSpeechGenerator(client), [client]);
  const narrator = useMemo(
    () => (narrate ? adminSpeechNarrator(client) : undefined),
    [client, narrate],
  );
  return useSpeechPlayer(generate, narrator);
}
