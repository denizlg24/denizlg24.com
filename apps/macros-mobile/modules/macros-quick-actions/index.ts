import { requireOptionalNativeModule } from "expo";

type MacrosQuickActionsNative = {
  /** The action a cold launch was opened with, once; null otherwise. */
  takePending(): string | null;
  addListener(
    event: "onAction",
    listener: (event: { type: string }) => void,
  ): { remove(): void };
};

/** Null outside an iOS native build (Android, Expo Go). */
export const MacrosQuickActions =
  requireOptionalNativeModule<MacrosQuickActionsNative>("MacrosQuickActions");
