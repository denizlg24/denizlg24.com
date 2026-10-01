"use client";

import { playSpeechSource, SpeechOutput } from "@repo/tts/react";
import { toast } from "sonner";
import type { AdminClient } from "../client";
import {
  adminSpeechGenerator,
  adminSpeechNarrator,
} from "../tts/use-admin-speech";
import { speakablePageText } from "./page-text";

let current: AbortController | null = null;
let output: SpeechOutput | null = null;

export function stopPageSpeech() {
  current?.abort();
  current = null;
}

export function readCurrentPageAloud(client: AdminClient) {
  const selection = window.getSelection()?.toString().trim();
  const main =
    document.querySelector<HTMLElement>(
      "main [data-agent-page], main [role=main]",
    ) ?? document.querySelector<HTMLElement>("main");
  const editors = main
    ? Array.from(main.querySelectorAll<HTMLTextAreaElement>("textarea"))
        .map((element) => element.value.trim())
        .filter(Boolean)
    : [];
  const text = (
    selection || [main ? speakablePageText(main) : "", ...editors].join("\n\n")
  )
    .trim()
    .slice(0, 100_000);
  if (!text) throw new Error("There is no readable text on this page");
  stopPageSpeech();
  output ??= new SpeechOutput();
  output.unlock();
  const abort = new AbortController();
  current = abort;
  void playSpeechSource(
    text,
    adminSpeechGenerator(client),
    abort.signal,
    undefined,
    output,
    adminSpeechNarrator(client),
  )
    .catch((error: unknown) => {
      if (!abort.signal.aborted)
        toast.error(
          error instanceof Error ? error.message : "Could not read this page",
        );
    })
    .finally(() => {
      if (current === abort) current = null;
    });
  return { started: true, characters: text.length };
}
