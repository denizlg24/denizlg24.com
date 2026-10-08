import { VoiceNative, type VoicePhase } from "@modules/voice-native";
import {
  type LlmModelsResponse,
  voiceTranscriptionResponseSchema,
} from "@repo/schemas";
import { pickDefaultModel } from "@repo/utils";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { type SharedValue, useSharedValue } from "react-native-reanimated";
import { getJson, postJson, send, uploadAudio } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { createSpeaker } from "./speech";
import {
  applyChunk,
  createEventParser,
  emptyTurn,
  fullText,
  spokenText,
  type TurnState,
} from "./stream";

export type VoiceState =
  | "idle"
  | "listening"
  | "thinking"
  | "responding"
  | "error";

export interface Exchange {
  id: string;
  question: string;
  reply: string;
}

// The PWA's tuning: a short noise sample so speech can start at once, and
// monosyllables accepted without mistaking one spike for an utterance.
const VAD_CALIBRATION_MS = 150;
const MIN_SPEECH_MS = 180;
const SILENCE_TO_SEND_MS = 1_500;
const NO_SPEECH_TIMEOUT_MS = 6_000;
const MAX_RECORDING_MS = 30_000;
const METER_INTERVAL_MS = 60;
/** A conversation idle longer than this starts a new one. */
const CONVERSATION_IDLE_MS = 15 * 60 * 1000;

const RECORDING = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  numberOfChannels: 1,
  bitRate: 48_000,
};

interface VoiceController {
  state: VoiceState;
  ticker: string;
  /** 0…1, the microphone level while listening. */
  level: SharedValue<number>;
  /** Grows on every streamed text update, for the orb's pulse. */
  pulse: SharedValue<number>;
  exchanges: Exchange[];
  start(): Promise<void>;
  /** Listening: discard. Thinking or replying: stop and go idle. */
  stop(): void;
  newConversation(): void;
}

const VoiceContext = createContext<VoiceController | null>(null);

export function useVoice() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error("useVoice outside VoiceProvider");
  return value;
}

function decibelsToLevel(db: number | undefined) {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return 10 ** (db / 20);
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const recorder = useAudioRecorder(RECORDING);
  const speaker = useMemo(() => createSpeaker(), []);
  const level = useSharedValue(0);
  const pulse = useSharedValue(0);
  const [state, setState] = useState<VoiceState>("idle");
  const [ticker, setTicker] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

  const stateRef = useRef<VoiceState>("idle");
  const sequence = useRef(0);
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const conversation = useRef<{ id: string; lastUsed: number } | null>(null);
  const model = useRef<string | null>(null);
  const startedAt = useRef(Date.now() / 1000);

  const phase = useCallback((next: VoiceState, text: string) => {
    stateRef.current = next;
    setState(next);
    setTicker(text);
    const activity: VoicePhase =
      next === "listening"
        ? "listening"
        : next === "thinking"
          ? "thinking"
          : next === "responding"
            ? "replying"
            : next === "error"
              ? "error"
              : "done";
    if (next === "idle" || next === "error") {
      void VoiceNative?.endActivity(activity, text, startedAt.current);
      VoiceNative?.endBackgroundTask();
    } else {
      void VoiceNative?.updateActivity(activity, text, startedAt.current);
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (meter.current) clearInterval(meter.current);
    meter.current = null;
    level.value = 0;
  }, [level]);

  const resolveModel = useCallback(async () => {
    if (model.current) return model.current;
    const { models } = await getJson<LlmModelsResponse>("llm/models");
    model.current = pickDefaultModel(models, ["tool-use"]);
    if (!model.current) throw new Error("Model unavailable");
    return model.current;
  }, []);

  const converse = useCallback(
    async (uri: string, mine: number) => {
      phase("thinking", "transcribing…");
      VoiceNative?.beginBackgroundTask();
      const parsed = voiceTranscriptionResponseSchema.parse(
        await uploadAudio("voice-notes/transcribe", uri),
      );
      const question = parsed.text.trim();
      if (!question) throw new Error("Nothing was said");
      if (mine !== sequence.current) return;
      phase("thinking", question);
      const chosen = await resolveModel();

      const now = Date.now();
      if (
        !conversation.current ||
        now - conversation.current.lastUsed > CONVERSATION_IDLE_MS
      ) {
        const created = await postJson<{ conversation: { _id: string } }>(
          "conversations",
          {
            title:
              question.length > 50 ? `${question.slice(0, 50)}…` : question,
            model: chosen,
            memoryMode: "enabled",
          },
        );
        conversation.current = { id: created.conversation._id, lastUsed: now };
      }
      conversation.current.lastUsed = now;

      const controller = new AbortController();
      abort.current = controller;
      const response = await send("chat", {
        method: "POST",
        signal: controller.signal,
        body: {
          conversationId: conversation.current.id,
          trigger: "submit-message",
          message: {
            id: Crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text: question }],
          },
          model: chosen,
          executionMode: "yolo",
          responseStyle: "voice",
          pageTools: false,
        },
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The reply was empty");
      const decoder = new TextDecoder();
      const parse = createEventParser();
      let turn: TurnState = emptyTurn;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (mine !== sequence.current) {
          void reader.cancel();
          return;
        }
        for (const chunk of parse(decoder.decode(value, { stream: true }))) {
          turn = applyChunk(turn, chunk);
        }
        if (turn.error) throw new Error(turn.error);
        if (turn.runningTool) {
          setTicker(turn.runningTool);
        } else {
          const text = fullText(turn);
          if (text) {
            pulse.value += 1;
            setTicker(text.split(/(?<=[.!?])\s+/).at(-1) ?? text);
          }
        }
      }
      const reply = spokenText(turn);
      if (!reply) {
        phase("idle", "");
        return;
      }
      setExchanges((current) => [
        ...current,
        { id: Crypto.randomUUID(), question, reply: fullText(turn) },
      ]);
      VoiceNative?.saveExchange(question, reply);
      if (AppState.currentState !== "active") {
        void Notifications.scheduleNotificationAsync({
          content: {
            title: question,
            body: reply,
            interruptionLevel: "active",
          },
          trigger: null,
        });
      }
      phase("responding", reply);
      await speaker.speak(reply);
      if (mine === sequence.current) phase("idle", "");
    },
    [phase, pulse, resolveModel, speaker],
  );

  const finishRecording = useCallback(
    async (sendIt: boolean, mine: number) => {
      stopMeter();
      await recorder.stop().catch(() => undefined);
      const uri = recorder.uri;
      if (!sendIt || !uri || mine !== sequence.current) {
        if (mine === sequence.current) phase("idle", "");
        return;
      }
      try {
        await converse(uri, mine);
      } catch (cause) {
        if (mine !== sequence.current) return;
        if (cause instanceof Error && cause.name === "AbortError") return;
        haptics.error();
        phase("error", cause instanceof Error ? cause.message : "Failed");
        setTimeout(() => {
          if (mine === sequence.current && stateRef.current === "error")
            phase("idle", "");
        }, 2_500);
      } finally {
        abort.current = null;
      }
    },
    [converse, phase, recorder, stopMeter],
  );

  const start = useCallback(async () => {
    const current = stateRef.current;
    if (current === "listening" || current === "thinking") return;
    const mine = ++sequence.current;
    speaker.stop();
    abort.current?.abort();
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      phase("error", "Microphone access denied");
      return;
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsBackgroundRecording: true,
      interruptionMode: "doNotMix",
    });
    await recorder.prepareToRecordAsync();
    recorder.record();
    haptics.light();
    startedAt.current = Date.now() / 1000;
    phase("listening", "listening…");

    const began = Date.now();
    let previous = began;
    let speechMs = 0;
    let lastSpeechAt: number | null = null;
    let noiseFloor = 0.008;
    meter.current = setInterval(() => {
      const now = Date.now();
      const rms = decibelsToLevel(recorder.getStatus().metering);
      level.value = Math.min(1, rms * 4);
      const delta = Math.min(150, now - previous);
      previous = now;
      const elapsed = now - began;
      if (elapsed <= VAD_CALIBRATION_MS) {
        noiseFloor = noiseFloor * 0.75 + rms * 0.25;
        return;
      }
      const threshold = Math.max(0.014, noiseFloor * 1.8 + 0.004);
      if (rms > threshold) {
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
        haptics.selection();
        void finishRecording(true, mine);
      } else if (speechMs < MIN_SPEECH_MS && elapsed >= NO_SPEECH_TIMEOUT_MS) {
        setTicker("No speech detected");
        void finishRecording(false, mine);
      } else if (elapsed >= MAX_RECORDING_MS) {
        void finishRecording(speechMs >= MIN_SPEECH_MS, mine);
      }
    }, METER_INTERVAL_MS);
  }, [finishRecording, level, phase, recorder, speaker]);

  const stop = useCallback(() => {
    const mine = ++sequence.current;
    if (stateRef.current === "listening") {
      void finishRecording(false, mine);
      return;
    }
    abort.current?.abort();
    speaker.stop();
    phase("idle", "");
  }, [finishRecording, phase, speaker]);

  const newConversation = useCallback(() => {
    stop();
    conversation.current = null;
    setExchanges([]);
    haptics.success();
  }, [stop]);

  // The Live Activity's Stop button, from the app's own process.
  useEffect(() => {
    const subscription = VoiceNative?.addListener("onStop", stop);
    return () => subscription?.remove();
  }, [stop]);

  useEffect(
    () => () => {
      stopMeter();
      speaker.release();
    },
    [speaker, stopMeter],
  );

  const value = useMemo<VoiceController>(
    () => ({
      state,
      ticker,
      level,
      pulse,
      exchanges,
      start,
      stop,
      newConversation,
    }),
    [state, ticker, level, pulse, exchanges, start, stop, newConversation],
  );
  return (
    <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
  );
}
