import { requireOptionalNativeModule } from "expo";

type MacrosWidgetsNative = {
  /** False unless this build carries the App Group the widgets read. */
  isAvailable(): boolean;
  /** A `WidgetSnapshot` as JSON; reloads every widget timeline. */
  setSnapshot(json: string): void;
  clear(): void;
};

/** Null on Android, in Expo Go and anywhere the native module was not built in. */
export const MacrosWidgets =
  requireOptionalNativeModule<MacrosWidgetsNative>("MacrosWidgets");
