import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

export type LocationAuthorization =
  | "always"
  | "whenInUse"
  | "denied"
  | "restricted"
  | "notDetermined"
  | "unknown";

export interface LocationFix {
  latitude: number;
  longitude: number;
  horizontalAccuracy: number;
  recordedAt: string;
}

export interface TrackerStatus {
  authorization: LocationAuthorization;
  precise: boolean;
  exploring: boolean;
  /** Standard updates are running: exploring, and the grant allows it. */
  liveActive: boolean;
  /** The current session's start, or the last one's while off. */
  startedAt: string | null;
  endedAt: string | null;
  distanceMetres: number;
  sessionPoints: number;
  pendingPoints: number;
  pendingVisits: number;
  /** Shops nearby with a geofence around them. */
  fencedShops: number;
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
  /** Starting clears the last session's trail; stopping uploads what is queued. */
  setExploring(on: boolean): Promise<void>;
  /** The current (or last) session, flat `[lon, lat, …]`. */
  sessionTrail(): number[];
  /** Uploads whatever is queued now. */
  flush(): Promise<void>;
  status(): Promise<TrackerStatus>;
};

/** Null in Expo Go and anywhere the native module was not built in. */
export const LocationNative =
  requireOptionalNativeModule<LocationNativeModule>("LocationNative");

export type MapFrameMode = "session" | "all" | "user";

export interface ExploredMapViewProps extends ViewProps {
  /** Flat `[lon, lat, …]` per track: `LocationExplored.tracks`. */
  tracks: number[][];
  spots: [number, number][];
  /** Flat `[lon, lat, …]`, drawn over everything else. */
  session: number[];
  /** Half the explored band's width. */
  radiusMetres: number;
  frameMode: MapFrameMode;
  /** Changing it frames the map again. */
  frameKey: number;
}

export const ExploredMapView: ComponentType<ExploredMapViewProps> | null =
  LocationNative ? requireNativeView("LocationNative") : null;
