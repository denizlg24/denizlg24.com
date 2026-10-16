import { requireOptionalNativeModule } from "expo";

export type LocationAuthorization =
  | "always"
  | "whenInUse"
  | "denied"
  | "restricted"
  | "notDetermined"
  | "unknown";

export type LiveMode = "off" | "auto" | "on";

export interface LocationFix {
  latitude: number;
  longitude: number;
  horizontalAccuracy: number;
  recordedAt: string;
}

export interface TrackerStatus {
  authorization: LocationAuthorization;
  precise: boolean;
  liveMode: LiveMode;
  liveActive: boolean;
  pendingPoints: number;
  pendingVisits: number;
  lastUploadAt: string | null;
  lastError: string | null;
  /** This process's latest fix; null until one arrives after launch. */
  lastFix: LocationFix | null;
}

type LocationNativeModule = {
  getSession(): string | null;
  setSession(json: string | null): void;
  installationId(): string;
  /** "While Using" first, then "Always" on the next call. */
  requestPermission(): Promise<void>;
  setLiveMode(mode: LiveMode): Promise<void>;
  /** Uploads whatever is queued now. */
  flush(): Promise<void>;
  status(): Promise<TrackerStatus>;
};

/** Null in Expo Go and anywhere the native module was not built in. */
export const LocationNative =
  requireOptionalNativeModule<LocationNativeModule>("LocationNative");
