"use client";

import { voiceTranscriptionResponseSchema } from "@repo/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import {
  AUDIO_CONSTRAINTS,
  appendLevel,
  extensionForMime,
  type LevelMeter,
  RECORDING_BITS_PER_SECOND,
  startLevelMeter,
  supportedMimeType,
} from "./audio-capture";

const MAX_DICTATION_BYTES = 24 * 1024 * 1024;
/** The composer meter is narrow; it shows the tail of the shared buffer. */
const LEVEL_SAMPLES = 24;

export type DictationStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing";

/**
 * Push-to-talk dictation for the agent composer. The audio is transcribed and
 * dropped — only the text the owner then sends is ever persisted, which is why
 * this does not go through the voice-note recorder.
 */
export function useDictation({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const { client } = useAdmin();
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const levelMeterRef = useRef<LevelMeter | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const byteLengthRef = useRef(0);
  const keepRef = useRef(true);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const releaseMedia = useCallback(() => {
    levelMeterRef.current?.stop();
    levelMeterRef.current = null;
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const reset = useCallback(() => {
    chunksRef.current = [];
    byteLengthRef.current = 0;
    setElapsedMs(0);
    setLevels([]);
  }, []);

  const finish = useCallback(
    async (mimeType: string) => {
      const keep = keepRef.current;
      const chunks = chunksRef.current;
      releaseMedia();
      if (!keep) {
        reset();
        setStatus("idle");
        return;
      }

      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      reset();
      if (blob.size === 0) {
        setStatus("idle");
        return;
      }

      setStatus("transcribing");
      const filename = `dictation-${Date.now()}.${extensionForMime(mimeType)}`;
      const formData = new FormData();
      formData.set("file", new File([blob], filename, { type: blob.type }));
      try {
        const result = await client.upload<unknown>(
          "voice-notes/transcribe",
          formData,
        );
        // A 2xx is not a guarantee of shape; parsing here keeps a malformed
        // payload from throwing out of the recorder's onstop handler.
        const parsed = voiceTranscriptionResponseSchema.safeParse(result);
        if (!parsed.success) {
          toast.error("Transcription returned an unexpected response");
          return;
        }
        const text = parsed.data.text.trim();
        if (!text) {
          toast.error("Nothing was said");
          return;
        }
        onTranscriptRef.current(text);
      } catch {
        toast.error("Could not transcribe recording");
      } finally {
        setStatus("idle");
      }
    },
    [client, releaseMedia, reset],
  );

  const start = useCallback(async () => {
    if (status !== "idle") return;
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
      });
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
      });
      const actualMimeType = recorder.mimeType || mimeType || "audio/webm";
      startedAtRef.current = Date.now();
      chunksRef.current = [];
      byteLengthRef.current = 0;
      keepRef.current = true;
      streamRef.current = stream;
      recorderRef.current = recorder;

      levelMeterRef.current = startLevelMeter(stream, (level) => {
        setLevels((current) =>
          appendLevel(current, level).slice(-LEVEL_SAMPLES),
        );
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        chunksRef.current.push(event.data);
        byteLengthRef.current += event.data.size;
        if (
          byteLengthRef.current >= MAX_DICTATION_BYTES &&
          recorder.state === "recording"
        ) {
          recorder.stop();
        }
      };
      recorder.onerror = () => {
        keepRef.current = false;
        releaseMedia();
        reset();
        setStatus("idle");
        toast.error("Recording failed");
      };
      recorder.onstop = () => {
        void finish(actualMimeType);
      };
      recorder.start(1_000);
      setElapsedMs(0);
      setStatus("recording");
      elapsedTimerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);
    } catch (cause) {
      releaseMedia();
      reset();
      setStatus("idle");
      toast.error(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access denied"
          : "Could not start recording",
      );
    }
  }, [finish, releaseMedia, reset, status]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    keepRef.current = true;
    recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    keepRef.current = false;
    recorder.stop();
  }, []);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseMedia();
    },
    [releaseMedia],
  );

  return {
    status,
    elapsedMs,
    levels,
    available: true,
    start,
    stop,
    cancel,
  };
}
