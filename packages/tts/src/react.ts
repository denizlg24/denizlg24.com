"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speechChunks } from "./index";
import {
  type NarratedKind,
  type SpeechSegment,
  speakableSegments,
} from "./narrate";

export interface SpeechAudio {
  blob: Blob;
}

export type SpeechSource = string | AsyncIterable<string>;

type SpeechState = "idle" | "loading" | "playing";

/** Requests in flight ahead of what is playing. */
const LOOKAHEAD = 3;
/** Segments resolved ahead of the chunker, so a block is narrated while earlier audio plays. */
const NARRATION_LOOKAHEAD = 6;

/** Turns code, a table or math into words; rejecting reads the block as written. */
export type SpeechNarrator = (
  segment: Extract<SpeechSegment, { kind: NarratedKind }>,
  signal: AbortSignal,
) => Promise<string>;

declare global {
  interface Navigator {
    /** Safari 17+: "playback" keeps Web Audio audible with the ringer muted. */
    audioSession?: { type: string };
  }
}

/** Where decoded clips go; `SpeechOutput` in the browser. */
export interface SpeechSink<Clip> {
  decode(blob: Blob): Promise<Clip>;
  /** Resolves when the clip has finished playing or was stopped. */
  schedule(clip: Clip): Promise<void>;
  stop(): void;
}

/**
 * One Web Audio context that plays decoded clips back to back on its clock,
 * so consecutive requests join without the gap a media element leaves
 * between sources.
 */
export class SpeechOutput implements SpeechSink<AudioBuffer> {
  private context: AudioContext | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private endsAt = 0;
  /** Bumped by `stop()`, so a `schedule()` still waiting on resume drops its clip. */
  private generation = 0;

  private ensure(): AudioContext {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext();
      this.endsAt = 0;
    }
    return this.context;
  }

  /** Call from a user gesture: browsers only start audio from one. */
  unlock() {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
    const context = this.ensure();
    void context.resume().catch(() => undefined);
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(1, 1, context.sampleRate);
    silence.connect(context.destination);
    silence.start();
  }

  async decode(blob: Blob): Promise<AudioBuffer> {
    return this.ensure().decodeAudioData(await blob.arrayBuffer());
  }

  /** Queues a clip after whatever is scheduled; resolves when it has finished (or was stopped). */
  async schedule(buffer: AudioBuffer): Promise<void> {
    const context = this.ensure();
    const generation = this.generation;
    const running = () => context.state === "running";
    if (!running()) {
      await Promise.race([
        context.resume(),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
      if (generation !== this.generation) return;
      if (!running()) {
        throw new Error("Audio is blocked until you interact with the page");
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.02, this.endsAt);
    this.endsAt = startAt + buffer.duration;
    this.sources.add(source);
    const ended = new Promise<void>((resolve) => {
      source.onended = () => {
        this.sources.delete(source);
        resolve();
      };
    });
    source.start(startAt);
    return ended;
  }

  stop() {
    this.generation += 1;
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.endsAt = 0;
  }

  close() {
    this.stop();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}

/** Runs `run` on up to `depth` items ahead of the consumer and yields results in order. */
async function* ahead<T, R>(
  items: AsyncIterable<T>,
  run: (item: T) => Promise<R>,
  depth: number,
): AsyncGenerator<R> {
  const iterator = items[Symbol.asyncIterator]();
  const queue: Promise<R>[] = [];
  let exhausted = false;
  let failure: { error: unknown } | null = null;
  const failed = (): { error: unknown } | null => failure;
  let pulling: Promise<void> | null = null;

  const pull = () => {
    pulling ??= (async () => {
      while (!exhausted && queue.length < depth) {
        const next = await iterator.next();
        if (next.done) {
          exhausted = true;
          break;
        }
        const task = run(next.value);
        // Awaited in order below; this only keeps a later failure from
        // surfacing as unhandled while an earlier clip is still playing.
        task.catch(() => undefined);
        queue.push(task);
      }
    })()
      .catch((error: unknown) => {
        failure = { error };
      })
      .finally(() => {
        pulling = null;
      });
    return pulling;
  };

  try {
    while (true) {
      if (queue.length === 0) {
        await pull();
        const pullFailure = failed();
        if (pullFailure) throw pullFailure.error;
        if (queue.length === 0 && exhausted) return;
        continue;
      }
      // The head stays queued until it resolves, so it counts toward `depth`.
      const head = queue[0];
      if (!head) continue;
      const value = await head;
      queue.shift();
      void pull();
      yield value;
    }
  } finally {
    await iterator.return?.();
  }
}

/** The source with every narrated segment replaced by its spoken form, in order. */
export function narratedSource(
  source: SpeechSource,
  narrate: SpeechNarrator,
  signal: AbortSignal,
): AsyncIterable<string> {
  const parts = typeof source === "string" ? [source] : source;
  return ahead(
    speakableSegments(parts),
    async (segment) => {
      if (segment.kind === "text") return segment.text;
      try {
        const spoken = (await narrate(segment, signal)).trim();
        return spoken ? `${spoken}\n\n` : "";
      } catch {
        return `${segment.text}\n\n`;
      }
    },
    NARRATION_LOOKAHEAD,
  );
}

export async function playSpeechSource<Clip = AudioBuffer>(
  source: SpeechSource,
  generate: (text: string, signal: AbortSignal) => Promise<SpeechAudio>,
  signal: AbortSignal,
  onState: ((state: "loading" | "playing") => void) | undefined,
  output: SpeechSink<Clip>,
  narrate?: SpeechNarrator,
) {
  const parts = narrate
    ? narratedSource(source, narrate, signal)
    : typeof source === "string"
      ? [source]
      : source;
  const onAbort = () => output.stop();
  signal.addEventListener("abort", onAbort, { once: true });
  // Only one clip waits behind the playing one, so stopping a long reading
  // early does not pay for synthesising the rest of it.
  let previous: Promise<void> = Promise.resolve();
  try {
    onState?.("loading");
    const clips = ahead(
      speechChunks(parts),
      async (text) => output.decode((await generate(text, signal)).blob),
      LOOKAHEAD,
    );
    for await (const clip of clips) {
      if (signal.aborted) return;
      const ended = output.schedule(clip);
      ended.catch(() => undefined);
      await previous;
      if (signal.aborted) return;
      onState?.("playing");
      previous = ended;
    }
    await previous;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function useSpeechPlayer(
  generate: (text: string, signal: AbortSignal) => Promise<SpeechAudio>,
  narrate?: SpeechNarrator,
) {
  const [state, setState] = useState<SpeechState>("idle");
  const controller = useRef<AbortController | null>(null);
  const output = useRef<SpeechOutput | null>(null);

  const prime = useCallback(() => {
    output.current ??= new SpeechOutput();
    output.current.unlock();
  }, []);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    output.current?.stop();
    setState("idle");
  }, []);

  useEffect(
    () => () => {
      stop();
      output.current?.close();
      output.current = null;
    },
    [stop],
  );

  const play = useCallback(
    async (source: SpeechSource) => {
      stop();
      prime();
      const sink = output.current ?? new SpeechOutput();
      output.current = sink;
      const abort = new AbortController();
      controller.current = abort;
      setState("loading");
      try {
        await playSpeechSource(
          source,
          generate,
          abort.signal,
          setState,
          sink,
          narrate,
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
    [generate, narrate, prime, stop],
  );

  return { state, play, stop, prime };
}
