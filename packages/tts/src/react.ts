"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { splitSpeechText } from "./index";

export interface SpeechAudio {
  blob: Blob;
}

export type SpeechSource = string | AsyncIterable<string>;

export async function playSpeechSource(
  source: SpeechSource,
  generate: (text: string, signal: AbortSignal) => Promise<SpeechAudio>,
  signal: AbortSignal,
  onState?: (state: "loading" | "playing") => void,
  reusableAudio?: HTMLAudioElement,
) {
  const parts =
    typeof source === "string"
      ? (async function* () {
          yield source;
        })()
      : source;
  for await (const part of parts) {
    for (const text of splitSpeechText(part)) {
      if (signal.aborted) return;
      onState?.("loading");
      const result = await generate(text, signal);
      if (signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      const element = reusableAudio ?? new Audio();
      element.src = url;
      element.volume = 1;
      try {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            element.pause();
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
          element.onended = () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          element.onerror = () => {
            signal.removeEventListener("abort", onAbort);
            reject(new Error("Audio playback failed"));
          };
          void element.play().then(() => {
            if (!signal.aborted) onState?.("playing");
          }, reject);
        });
      } finally {
        element.pause();
        URL.revokeObjectURL(url);
      }
    }
  }
}

/** Sequential playback keeps long readings bounded to one generated clip at a time. */
export function useSpeechPlayer(
  generate: (text: string, signal: AbortSignal) => Promise<SpeechAudio>,
) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const controller = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const prime = useCallback(() => {
    if (audio.current) return;
    // A brief silent WAV starts this media element during a user gesture.
    // Reusing it lets mobile browsers play the response after network work.
    const bytes = new Uint8Array(48);
    const view = new DataView(bytes.buffer);
    for (const [offset, value] of [
      [0, "RIFF"],
      [8, "WAVE"],
      [12, "fmt "],
      [36, "data"],
    ] as const) {
      for (let index = 0; index < value.length; index++) {
        bytes[offset + index] = value.charCodeAt(index);
      }
    }
    view.setUint32(4, 40, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8_000, true);
    view.setUint32(28, 16_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(40, 4, true);
    const element = new Audio();
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    element.src = url;
    void element
      .play()
      .catch(() => undefined)
      .finally(() => {
        if (element.src === url) element.pause();
        URL.revokeObjectURL(url);
      });
    audio.current = element;
  }, []);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    audio.current?.pause();
    setState("idle");
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    async (source: SpeechSource) => {
      stop();
      prime();
      const abort = new AbortController();
      controller.current = abort;
      setState("loading");
      try {
        await playSpeechSource(
          source,
          generate,
          abort.signal,
          setState,
          audio.current ?? undefined,
        );
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setState("idle");
        }
      }
    },
    [generate, prime, stop],
  );

  return { state, play, stop, prime };
}
