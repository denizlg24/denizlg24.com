"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";

const MAX_DICTATION_BYTES = 24 * 1024 * 1024;
const DICTATION_BITS_PER_SECOND = 24_000;
const LEVEL_SAMPLES = 24;

export type DictationStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing";

function supportedMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return (
    candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ??
    ""
  );
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

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
  const { settings, loading } = useUserSettings();
  const api = useMemo(
    () => (loading || !settings.apiKey ? null : new denizApi(settings.apiKey)),
    [loading, settings.apiKey],
  );
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
    if (analyserTimerRef.current) clearInterval(analyserTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    analyserTimerRef.current = null;
    elapsedTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
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
      if (!keep || !api) {
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
      const result = await api.UPLOAD<{ text: string }>({
        endpoint: "voice-notes/transcribe",
        formData,
      });
      setStatus("idle");
      if ("code" in result) {
        toast.error(result.message);
        return;
      }
      const text = result.text.trim();
      if (!text) {
        toast.error("Nothing was said");
        return;
      }
      onTranscriptRef.current(text);
    },
    [api, releaseMedia, reset],
  );

  const start = useCallback(async () => {
    if (status !== "idle" || !api) return;
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: DICTATION_BITS_PER_SECOND,
      });
      const actualMimeType = recorder.mimeType || mimeType || "audio/webm";
      startedAtRef.current = Date.now();
      chunksRef.current = [];
      byteLengthRef.current = 0;
      keepRef.current = true;
      streamRef.current = stream;
      recorderRef.current = recorder;

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;
      const timeDomain = new Uint8Array(analyser.fftSize);
      analyserTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(timeDomain);
        let sum = 0;
        for (const sample of timeDomain) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        }
        const level = Math.min(1, Math.sqrt(sum / timeDomain.length) * 3.5);
        setLevels((current) => [...current.slice(-(LEVEL_SAMPLES - 1)), level]);
      }, 100);

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
  }, [api, finish, releaseMedia, reset, status]);

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
    available: api !== null,
    start,
    stop,
    cancel,
  };
}
