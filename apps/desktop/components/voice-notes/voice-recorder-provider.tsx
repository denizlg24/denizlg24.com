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
import {
  AUDIO_CONSTRAINTS,
  appendLevel,
  downsample,
  extensionForMime,
  type LevelMeter,
  RECORDING_BITS_PER_SECOND,
  startLevelMeter,
  supportedMimeType,
} from "@/lib/audio-capture";
import { useBackgroundTasksStore } from "@/stores/background-tasks";

const MAX_RECORDING_BYTES = 24 * 1024 * 1024;
const WAVEFORM_SAMPLES = 180;

type RecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "uploading"
  | "error";

interface VoiceRecorderContextValue {
  status: RecorderStatus;
  elapsedMs: number;
  levels: number[];
  error?: string;
  lastVoiceNote?: IVoiceNote;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
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

export function VoiceRecorderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { settings, loading: loadingSettings } = useUserSettings();
  // Null until a key exists: constructing the wrapper with an empty key made
  // every upload fail as a 401 that read like a recording fault.
  const api = useMemo(
    () =>
      loadingSettings || !settings.apiKey
        ? null
        : new denizApi(settings.apiKey),
    [loadingSettings, settings.apiKey],
  );
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string>();
  const [lastVoiceNote, setLastVoiceNote] = useState<IVoiceNote>();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const levelMeterRef = useRef<LevelMeter | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const activeStartedAtRef = useRef(0);
  const accumulatedElapsedMsRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const byteLengthRef = useRef(0);
  const samplesRef = useRef<number[]>([]);
  const saveOnStopRef = useRef(true);
  const recorderErrorRef = useRef(false);
  const titleRef = useRef("");

  const clearTimers = useCallback(() => {
    levelMeterRef.current?.stop();
    levelMeterRef.current = null;
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }, []);

  const releaseMedia = useCallback(() => {
    clearTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, [clearTimers]);

  const currentElapsed = useCallback(() => {
    const activeElapsed = activeStartedAtRef.current
      ? Date.now() - activeStartedAtRef.current
      : 0;
    return accumulatedElapsedMsRef.current + activeElapsed;
  }, []);

  const freezeElapsed = useCallback(() => {
    const elapsed = currentElapsed();
    accumulatedElapsedMsRef.current = elapsed;
    activeStartedAtRef.current = 0;
    setElapsedMs(elapsed);
    return elapsed;
  }, [currentElapsed]);

  const startCaptureMeters = useCallback((stream: MediaStream) => {
    levelMeterRef.current = startLevelMeter(
      stream,
      (level) => {
        samplesRef.current.push(level);
        setLevels((current) => appendLevel(current, level));
      },
      120,
    );
    elapsedTimerRef.current = setInterval(() => {
      const elapsed =
        accumulatedElapsedMsRef.current +
        (activeStartedAtRef.current
          ? Date.now() - activeStartedAtRef.current
          : 0);
      setElapsedMs(elapsed);
      useBackgroundTasksStore.getState().update("voice-recording", {
        statusText: `REC ${formatDuration(elapsed)}`,
        color: "bg-red-500",
      });
    }, 500);
  }, []);

  const finishRecording = useCallback(
    async (mimeType: string) => {
      const durationMs = currentElapsed();
      accumulatedElapsedMsRef.current = durationMs;
      activeStartedAtRef.current = 0;
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

      // Recording is allowed to start before the key resolves; discarding the
      // audio silently at the upload step would lose what was just said.
      if (!api) {
        chunksRef.current = [];
        samplesRef.current = [];
        byteLengthRef.current = 0;
        useBackgroundTasksStore.getState().unregister("voice-recording");
        setStatus("error");
        setError("No API key configured");
        toast.error("No API key configured");
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
    [api, currentElapsed, releaseMedia],
  );

  const startRecording = useCallback(async () => {
    if (status !== "idle" && status !== "error") return;
    if (!api) {
      setStatus("error");
      setError("No API key configured");
      toast.error("No API key configured");
      return;
    }
    setStatus("requesting");
    setError(undefined);
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
      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      activeStartedAtRef.current = startedAt;
      accumulatedElapsedMsRef.current = 0;
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

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        chunksRef.current.push(event.data);
        byteLengthRef.current += event.data.size;
        if (
          byteLengthRef.current >= MAX_RECORDING_BYTES &&
          recorder.state === "recording"
        ) {
          toast.warning("Recording limit reached; saving voice note");
          const elapsed =
            accumulatedElapsedMsRef.current +
            (activeStartedAtRef.current
              ? Date.now() - activeStartedAtRef.current
              : 0);
          accumulatedElapsedMsRef.current = elapsed;
          activeStartedAtRef.current = 0;
          clearTimers();
          setStatus("uploading");
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
      startCaptureMeters(stream);
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
  }, [
    api,
    clearTimers,
    finishRecording,
    releaseMedia,
    startCaptureMeters,
    status,
  ]);

  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "recording") return;
    recorder.pause();
    const elapsed = freezeElapsed();
    clearTimers();
    setStatus("paused");
    useBackgroundTasksStore.getState().update("voice-recording", {
      statusText: `PAUSED ${formatDuration(elapsed)}`,
      color: "bg-amber-500",
    });
  }, [clearTimers, freezeElapsed]);

  const resumeRecording = useCallback(() => {
    const recorder = recorderRef.current;
    const stream = streamRef.current;
    if (!recorder || !stream || recorder.state !== "paused") return;
    recorder.resume();
    activeStartedAtRef.current = Date.now();
    setStatus("recording");
    useBackgroundTasksStore.getState().update("voice-recording", {
      statusText: `REC ${formatDuration(accumulatedElapsedMsRef.current)}`,
      color: "bg-red-500",
    });
    startCaptureMeters(stream);
  }, [startCaptureMeters]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    saveOnStopRef.current = true;
    if (recorder.state === "recording") freezeElapsed();
    clearTimers();
    setStatus("uploading");
    recorder.stop();
  }, [clearTimers, freezeElapsed]);

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
    if (recorder.state === "recording") freezeElapsed();
    clearTimers();
    recorder.stop();
  }, [clearTimers, freezeElapsed]);

  const value = useMemo(
    () => ({
      status,
      elapsedMs,
      levels,
      error,
      lastVoiceNote,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      discardRecording,
    }),
    [
      discardRecording,
      elapsedMs,
      error,
      lastVoiceNote,
      levels,
      pauseRecording,
      resumeRecording,
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
