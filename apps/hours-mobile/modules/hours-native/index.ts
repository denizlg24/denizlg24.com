import { requireOptionalNativeModule } from "expo";

type HoursNativeModule = {
  getSession(): string | null;
  setSession(json: string | null): void;
  installationId(): string;
  activitiesEnabled(): boolean;
  getSettings(): string | null;
  setSettings(json: string): void;
  /** A `WorkHoursOverview` as JSON: stored, then the Live Activity and widgets follow it. */
  setOverview(json: string): Promise<void>;
  /** Ends the activity and empties the widgets. */
  clear(): Promise<void>;
  /** Stops the server pushing to this install; needs the session, so call it first. */
  forgetDevice(): Promise<void>;
  /** Starts reporting Live Activity push tokens to the server. */
  registerDevice(): Promise<void>;
};

/** Null in Expo Go and anywhere the native module was not built in. */
export const HoursNative =
  requireOptionalNativeModule<HoursNativeModule>("HoursNative");
