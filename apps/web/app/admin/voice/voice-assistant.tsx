"use client";

import { useAgentStream } from "@repo/admin/agent/use-agent-stream";
import {
  pickDefaultModel,
  useModelCatalog,
} from "@repo/admin/agent/use-model-catalog";
import { useAdmin } from "@repo/admin/provider";
import { getToolLabel, voiceTranscriptionResponseSchema } from "@repo/schemas";
import { useCallback, useEffect, useRef, useState } from "react";

type VoiceState = "idle" | "listening" | "thinking" | "responding" | "error";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

// Keep the initial noise sample brief so a user can speak immediately after
// tapping, and accept monosyllables without mistaking a single audio spike for
// an utterance.
const VAD_CALIBRATION_MS = 150;
const MIN_SPEECH_MS = 180;
const SILENCE_TO_SEND_MS = 1_500;
const NO_SPEECH_TIMEOUT_MS = 6_000;
const MAX_RECORDING_MS = 20_000;
const TICKER_CHARACTER_MS = 45;

function supportedMimeType(): string {
  return (
    MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
  );
}

function extensionForMime(type: string): string {
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4")) return "m4a";
  return "webm";
}

function latestTickerText(text: string): string {
  const trimmed = text.trim();
  for (let index = trimmed.length - 1; index > 0; index--) {
    const character = trimmed[index];
    if (
      character !== undefined &&
      character.trim() === "" &&
      ".!?".includes(trimmed[index - 1] ?? "")
    ) {
      return trimmed.slice(index + 1).trim() || trimmed;
    }
  }
  return trimmed;
}

function VoiceOrb({
  state,
  level,
  pulse,
  onClick,
}: {
  state: VoiceState;
  level: number;
  pulse: number;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const pulseRef = useRef(pulse);
  stateRef.current = state;
  levelRef.current = level;
  pulseRef.current = pulse;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frame = 0;
    let animation = 0;
    let lastPulse = pulseRef.current;
    let pulseEnergy = 0;
    const styles = getComputedStyle(canvas);
    const color = (token: string, fallback: string) =>
      styles.getPropertyValue(token).trim() || fallback;
    const palette = {
      accent: color("--accent", "#a1bc98"),
      accentStrong: color("--accent-strong", "#303630"),
      destructive: color("--destructive", "#c0352b"),
      foreground: color("--foreground", "#647560"),
      surface: color("--surface", "#f1f3e0"),
    };

    const draw = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      const current = stateRef.current;
      const seconds = time / 1_000;
      if (lastPulse !== pulseRef.current) {
        lastPulse = pulseRef.current;
        pulseEnergy = 1;
      }
      pulseEnergy *= 0.9;
      const base = Math.min(rect.width, rect.height) * 0.285;
      const breathing = reduced ? 0 : Math.sin(seconds * 1.25) * 0.025;
      const listening = current === "listening" ? levelRef.current * 0.18 : 0;
      const responding = current === "responding" ? pulseEnergy * 0.06 : 0;
      const radius = base * (1 + breathing + listening + responding);
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const points = 96;

      context.beginPath();
      for (let index = 0; index <= points; index++) {
        const angle = (index / points) * Math.PI * 2;
        const harmonic = reduced
          ? 0
          : Math.sin(angle * 3 + seconds * 0.8) * 0.025 +
            Math.sin(angle * 5 - seconds * 0.55) * 0.014 +
            Math.sin(angle * 7 + seconds * 0.35) * 0.008;
        const r = radius * (1 + harmonic);
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      const gradient = context.createRadialGradient(
        centerX - radius * 0.38,
        centerY - radius * 0.42,
        radius * 0.08,
        centerX,
        centerY,
        radius * 1.2,
      );
      if (current === "error") {
        gradient.addColorStop(0, palette.surface);
        gradient.addColorStop(0.5, palette.destructive);
        gradient.addColorStop(1, palette.accentStrong);
      } else {
        gradient.addColorStop(0, palette.surface);
        gradient.addColorStop(0.48, palette.accent);
        gradient.addColorStop(1, palette.accentStrong);
      }
      context.fillStyle = gradient;
      context.shadowColor = palette.accent;
      context.shadowBlur = 32;
      context.fill();
      context.shadowBlur = 0;

      if (current === "thinking") {
        context.beginPath();
        context.arc(
          centerX,
          centerY,
          radius * 1.28,
          reduced ? 0 : seconds * 1.7,
          (reduced ? 0 : seconds * 1.7) + Math.PI * 1.25,
        );
        context.strokeStyle = palette.foreground;
        context.lineWidth = 2;
        context.lineCap = "round";
        context.stroke();
      }
      frame += 1;
      animation = requestAnimationFrame(draw);
    };
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, []);

  return (
    <button
      type="button"
      aria-label={
        state === "listening" ? "Cancel recording" : "Start recording"
      }
      onClick={onClick}
      className="size-[min(72vw,22rem)] touch-manipulation rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <canvas ref={canvasRef} className="size-full" />
    </button>
  );
}

export function VoiceAssistant() {
  const { client } = useAdmin();
  const modelCatalog = useModelCatalog();
  const { streamSegments, streamChat } = useAgentStream();
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [tickerTarget, setTickerTarget] = useState("");
  const [ticker, setTicker] = useState("");
  const tickerRef = useRef<HTMLParagraphElement>(null);
  const conversationIdRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const sendOnStopRef = useRef(false);

  const model = modelCatalog.models
    ? pickDefaultModel(modelCatalog.models, ["tool-use"])
    : null;

  useEffect(() => {
    const text = streamSegments
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.text)
      .join("");
    const tool = [...streamSegments]
      .reverse()
      .find((segment) => segment.type === "tool_group");
    if (
      tool?.type === "tool_group" &&
      tool.calls.at(-1)?.status === "calling"
    ) {
      setTickerTarget(getToolLabel(tool.calls.at(-1)?.toolName ?? ""));
      return;
    }
    if (text) {
      setState("responding");
      setPulse((current) => current + 1);
      setTickerTarget(latestTickerText(text));
    }
  }, [streamSegments]);

  useEffect(() => {
    if (!tickerTarget) {
      setTicker("");
      return;
    }
    if (!tickerTarget.startsWith(ticker)) {
      setTicker("");
      return;
    }
    if (ticker.length >= tickerTarget.length) return;
    const timer = setTimeout(() => {
      setTicker(tickerTarget.slice(0, ticker.length + 1));
    }, TICKER_CHARACTER_MS);
    return () => clearTimeout(timer);
  }, [tickerTarget, ticker]);

  useEffect(() => {
    const tickerElement = tickerRef.current;
    if (tickerElement) tickerElement.scrollLeft = tickerElement.scrollWidth;
  }, [ticker]);

  const releaseMedia = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    setLevel(0);
  }, []);

  const sendTranscript = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (!model) {
        setState("error");
        setTickerTarget("Model unavailable");
        return;
      }
      setState("thinking");
      setTickerTarget("transcribing…");
      try {
        const formData = new FormData();
        const type = mimeType.split(";")[0] || "audio/webm";
        formData.set(
          "file",
          new File([blob], `voice.${extensionForMime(mimeType)}`, { type }),
        );
        const raw = await client.upload<unknown>(
          "voice-notes/transcribe",
          formData,
        );
        const parsed = voiceTranscriptionResponseSchema.parse(raw);
        const text = parsed.text.trim();
        if (!text) throw new Error("Nothing was said");
        setTickerTarget(text);

        if (!conversationIdRef.current) {
          const created = await client.post<{ conversation: { _id: string } }>(
            "conversations",
            {
              title: text.length > 50 ? `${text.slice(0, 50)}…` : text,
              model,
              memoryMode: "enabled",
            },
          );
          conversationIdRef.current = created.conversation._id;
        }

        const result = await streamChat({
          conversationId: conversationIdRef.current,
          message: text,
          model,
          toolsEnabled: true,
          executionMode: "yolo",
          maxRounds: 15,
          responseStyle: "voice",
        });
        if (result && "error" in result) throw new Error(result.error);
        if (result) setTickerTarget(latestTickerText(result.content));
        setState("responding");
      } catch (cause) {
        setState("error");
        setTickerTarget(cause instanceof Error ? cause.message : "Failed");
        setTimeout(() => setState("idle"), 1_200);
      }
    },
    [client, model, streamChat],
  );

  const stopRecording = useCallback((send: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    sendOnStopRef.current = send;
    recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (state !== "idle" && state !== "responding" && state !== "error") return;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      const preferred = supportedMimeType();
      const recorder = new MediaRecorder(media, {
        ...(preferred ? { mimeType: preferred } : {}),
        audioBitsPerSecond: 24_000,
      });
      const actualType = recorder.mimeType || preferred || "audio/webm";
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(media).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const listeningStartedAt = performance.now();
      let previous = listeningStartedAt;
      let speechMs = 0;
      let lastSpeechAt: number | null = null;
      let noiseFloor = 0.008;

      chunksRef.current = [];
      sendOnStopRef.current = false;
      streamRef.current = media;
      recorderRef.current = recorder;
      audioContextRef.current = audioContext;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const shouldSend = sendOnStopRef.current;
        const blob = new Blob(chunksRef.current, {
          type: actualType.split(";")[0],
        });
        chunksRef.current = [];
        releaseMedia();
        if (shouldSend && blob.size > 0) void sendTranscript(blob, actualType);
        else setState("idle");
      };
      recorder.start(500);
      setTickerTarget("listening…");
      setState("listening");

      const analyse = (now: number) => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / samples.length);
        setLevel(Math.min(1, rms * 4));
        const delta = Math.min(100, now - previous);
        previous = now;
        const elapsed = now - listeningStartedAt;

        if (elapsed <= VAD_CALIBRATION_MS) {
          noiseFloor = noiseFloor * 0.75 + rms * 0.25;
          animationRef.current = requestAnimationFrame(analyse);
          return;
        }

        const speechThreshold = Math.max(0.014, noiseFloor * 1.8 + 0.004);
        if (rms > speechThreshold) {
          speechMs += delta;
          lastSpeechAt = now;
        } else {
          noiseFloor = noiseFloor * 0.97 + rms * 0.03;
        }

        if (
          speechMs >= MIN_SPEECH_MS &&
          lastSpeechAt !== null &&
          now - lastSpeechAt >= SILENCE_TO_SEND_MS
        ) {
          stopRecording(true);
          return;
        }
        if (speechMs < MIN_SPEECH_MS && elapsed >= NO_SPEECH_TIMEOUT_MS) {
          setTickerTarget("No speech detected");
          stopRecording(false);
          return;
        }
        if (elapsed >= MAX_RECORDING_MS) {
          stopRecording(speechMs >= MIN_SPEECH_MS);
          return;
        }
        animationRef.current = requestAnimationFrame(analyse);
      };
      animationRef.current = requestAnimationFrame(analyse);
    } catch (cause) {
      releaseMedia();
      setState("error");
      setTickerTarget(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access denied"
          : "Microphone unavailable",
      );
      setTimeout(() => setState("idle"), 1_200);
    }
  }, [releaseMedia, sendTranscript, state, stopRecording]);

  useEffect(() => releaseMedia, [releaseMedia]);

  return (
    <main className="-mt-26 flex h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-background px-5">
      <VoiceOrb
        state={state}
        level={level}
        pulse={pulse}
        onClick={() => {
          if (state === "listening") stopRecording(false);
          else void startRecording();
        }}
      />
      <p
        ref={tickerRef}
        className="mt-6 h-6 w-full max-w-xl overflow-hidden whitespace-nowrap text-sm text-muted-foreground"
      >
        <span className="inline-block min-w-full text-center">
          {ticker || " "}
        </span>
      </p>
    </main>
  );
}
