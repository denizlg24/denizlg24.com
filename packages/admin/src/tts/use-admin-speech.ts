"use client";

import { useSpeechPlayer } from "@repo/tts/react";
import { useCallback } from "react";
import type { AdminClient } from "../client";

export function useAdminSpeech(client: AdminClient) {
  const generate = useCallback(
    async (text: string, signal: AbortSignal) => {
      const response = await client.raw("tts", {
        method: "POST",
        body: { text },
        signal,
      });
      return { blob: await response.blob() };
    },
    [client],
  );
  return useSpeechPlayer(generate);
}
