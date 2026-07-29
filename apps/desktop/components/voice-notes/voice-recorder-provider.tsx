"use client";

import type { IVoiceNote } from "@repo/schemas";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import { useBackgroundTasksStore } from "@/stores/background-tasks";

const MAX_RECORDING_BYTES = 24 * 1024 * 1024;
const RECORDING_BITS_PER_SECOND = 24_000;
const WAVEFORM_SAMPLES = 180;

type RecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "uploading"
  | "error";

interface VoiceRecorderContextValue {
  status: RecorderStatus;
  elapsedMs: number;
  levels: number[];
  error?: string;
  lastVoiceNote?: IVoiceNote;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  discardRecording: () => void;
}

const VoiceRecorderContext = createContext<VoiceRecorderContextValue | null>(
  null,
);

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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

function downsample(values: number[], count: number) {
  if (values.length <= count) return values;
  const samples: number[] = [];
  const stride = values.length / count;
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * stride);
    const end = Math.max(start + 1, Math.floor((index + 1) * stride));
    samples.push(Math.max(...values.slice(start, end)));
  }
  return samples;
}

export function VoiceRecorderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { settings } = useUserSettings();
  const api = useMemo(() => new denizApi(settings.apiKey), [settings.apiKey]);
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string>();
  const [lastVoiceNote, setLastVoiceNote] = useState<IVoiceNote>();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const byteLengthRef = useRef(0);
  const samplesRef = useRef<number[]>([]);
  const saveOnStopRef = useRef(true);
  const recorderErrorRef = useRef(false);
  const titleRef = useRef("");

  const clearTimers = useCallback(() => {
    if (analyserTimerRef.current) clearInterval(analyserTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    analyserTimerRef.current = null;
    elapsedTimerRef.current = null;
  }, []);

  const releaseMedia = useCallback(() => {
    clearTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    recorderRef.current = null;
  }, [clearTimers]);

  const finishRecording = useCallback(
    async (mimeType: string) => {
      const durationMs = Date.now() - startedAtRef.current;
      const shouldSave = saveOnStopRef.current;
      const chunks = chunksRef.current;
      const waveform = downsample(samplesRef.current, WAVEFORM_SAMPLES);
      releaseMedia();

      if (!shouldSave) {
        chunksRef.current = [];
        samplesRef.current = [];
        byteLengthRef.current = 0;
        setStatus(recorderErrorRef.current ? "error" : "idle");
        setElapsedMs(0);
        setLevels([]);
        useBackgroundTasksStore.getState().unregister("voice-recording");
        return;
      }

      setStatus("uploading");
      useBackgroundTasksStore.getState().update("voice-recording", {
        active: true,
        color: "bg-amber-500",
        statusText: "Saving voice note",
      });
      const extension = extensionForMime(mimeType);
      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      if (blob.size === 0) {
        chunksRef.current = [];
        samplesRef.current = [];
        byteLengthRef.current = 0;
        useBackgroundTasksStore.getState().unregister("voice-recording");
        setStatus("error");
        setError("Recording was empty");
        return;
      }
      const filename = `voice-note-${new Date(startedAtRef.current).toISOString().replace(/[:.]/g, "-")}.${extension}`;
      const formData = new FormData();
      formData.set("file", new File([blob], filename, { type: blob.type }));
      formData.set("title", titleRef.current);
      formData.set("titleSource", "placeholder");
      formData.set("durationMs", String(durationMs));
      formData.set("waveform", JSON.stringify(waveform));
      formData.set("source", "recording");

      const result = await api.UPLOAD<{ voiceNote: IVoiceNote }>({
        endpoint: "voice-notes",
        formData,
      });
      chunksRef.current = [];
      samplesRef.current = [];
      byteLengthRef.current = 0;
      useBackgroundTasksStore.getState().unregister("voice-recording");
      setElapsedMs(0);
      setLevels([]);
      if ("code" in result) {
        setStatus("error");
        setError(result.message);
        toast.error(result.message);
        return;
      }
      setLastVoiceNote(result.voiceNote);
      setStatus("idle");
      window.dispatchEvent(new CustomEvent("voice-notes:changed"));
      toast.success("Voice note saved");
    },
    [api, releaseMedia],
  );

  const startRecording = useCallback(async () => {
    if (status !== "idle" && status !== "error") return;
    setStatus("requesting");
    setError(undefined);
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
        audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
      });
      const actualMimeType = recorder.mimeType || mimeType || "audio/webm";
      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      titleRef.current = `Voice note · ${new Date(startedAt).toLocaleString(
        undefined,
        {
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
      )}`;
      chunksRef.current = [];
      samplesRef.current = [];
      byteLengthRef.current = 0;
      saveOnStopRef.current = true;
      recorderErrorRef.current = false;
      streamRef.current = stream;
      recorderRef.current = recorder;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
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
        samplesRef.current.push(level);
        setLevels((current) => [...current.slice(-79), level]);
      }, 120);

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        chunksRef.current.push(event.data);
        byteLengthRef.current += event.data.size;
        if (
          byteLengthRef.current >= MAX_RECORDING_BYTES &&
          recorder.state === "recording"
        ) {
          toast.warning("Recording limit reached; saving voice note");
          recorder.stop();
        }
      };
      recorder.onerror = () => {
        recorderErrorRef.current = true;
        saveOnStopRef.current = false;
        setError("Recording failed");
        setStatus("error");
        releaseMedia();
        useBackgroundTasksStore.getState().unregister("voice-recording");
      };
      recorder.onstop = () => {
        void finishRecording(actualMimeType);
      };
      recorder.start(1_000);
      setElapsedMs(0);
      setStatus("recording");
      useBackgroundTasksStore.getState().register({
        id: "voice-recording",
        label: "Voice recording",
        statusText: "REC 0:00",
        color: "bg-red-500",
        active: true,
        href: "/dashboard/voice-notes",
      });
      elapsedTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        useBackgroundTasksStore.getState().update("voice-recording", {
          statusText: `REC ${formatDuration(elapsed)}`,
        });
      }, 500);
    } catch (cause) {
      releaseMedia();
      const message =
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access denied"
          : cause instanceof Error
            ? cause.message
            : "Could not start recording";
      setError(message);
      setStatus("error");
      toast.error(message);
    }
  }, [finishRecording, releaseMedia, status]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    saveOnStopRef.current = true;
    clearTimers();
    setStatus("uploading");
    recorder.stop();
  }, [clearTimers]);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseMedia();
      useBackgroundTasksStore.getState().unregister("voice-recording");
    },
    [releaseMedia],
  );

  const discardRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    saveOnStopRef.current = false;
    clearTimers();
    recorder.stop();
  }, [clearTimers]);

  const value = useMemo(
    () => ({
      status,
      elapsedMs,
      levels,
      error,
      lastVoiceNote,
      startRecording,
      stopRecording,
      discardRecording,
    }),
    [
      discardRecording,
      elapsedMs,
      error,
      lastVoiceNote,
      levels,
      startRecording,
      status,
      stopRecording,
    ],
  );

  return (
    <VoiceRecorderContext.Provider value={value}>
      {children}
    </VoiceRecorderContext.Provider>
  );
}

export function useVoiceRecorder() {
  const context = useContext(VoiceRecorderContext);
  if (!context) {
    throw new Error(
      "useVoiceRecorder must be used within VoiceRecorderProvider",
    );
  }
  return context;
}

export { formatDuration };
