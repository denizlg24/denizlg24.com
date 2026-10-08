import { requireOptionalNativeModule } from "expo";

export type VoicePhase =
  | "listening"
  | "thinking"
  | "replying"
  | "done"
  | "error";

type VoiceNativeModule = {
  updateActivity(
    phase: VoicePhase,
    text: string,
    startedAt: number,
  ): Promise<void>;
  endActivity(
    phase: VoicePhase,
    text: string,
    startedAt: number,
  ): Promise<void>;
  saveExchange(question: string, reply: string): void;
  clearExchange(): void;
  beginBackgroundTask(): void;
  endBackgroundTask(): void;
  addListener(event: "onStop", listener: () => void): { remove(): void };
};

/** Null in Expo Go and anywhere the native module was not built in. */
export const VoiceNative =
  requireOptionalNativeModule<VoiceNativeModule>("VoiceNative");
