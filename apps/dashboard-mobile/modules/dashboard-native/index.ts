import { requireOptionalNativeModule } from "expo";

export interface SpotlightItem {
  /** `<domain>:<id>`, unique across the app. */
  id: string;
  domain: "notes" | "contacts" | "courses";
  title: string;
  /** One line at most; never a body. */
  description?: string;
  url: string;
}

type DashboardNativeModule = {
  getSession(): string | null;
  setSession(json: string | null): void;
  installationId(): string;
  getSettings(): string | null;
  setSettings(json: string): void;
  /** A `DashboardToday` as JSON: stored for the widgets, which redraw from it. */
  setToday(json: string): void;
  /** A `MarketQuote[]` the app already paid for; the widget never fetches quotes. */
  setWatchlist(json: string): void;
  /** Replaces one domain's items in the Spotlight index. */
  indexSpotlight(
    domain: SpotlightItem["domain"],
    itemsJson: string,
  ): Promise<void>;
  /** Signed out: every widget emptied, every Spotlight domain deleted. */
  clear(): Promise<void>;
};

/** Null in Expo Go and anywhere the native module was not built in. */
export const DashboardNative =
  requireOptionalNativeModule<DashboardNativeModule>("DashboardNative");
