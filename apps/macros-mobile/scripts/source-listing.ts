import type { AppListing, SourceListing } from "./sidestore-source";

const iconURL = "https://macros.denizlg24.com/apple-touch-icon-1024x1024.png";

export const sourceListing: SourceListing = {
  name: "Macros",
  subtitle: "Macros for iPhone",
  description:
    "Builds of the Macros iPhone app, published from github.com/denizlg24/denizlg24.com.",
  iconURL,
  website: "https://macros.denizlg24.com/ios",
  tintColor: "#111111",
};

export const appListing: AppListing = {
  name: "Macros",
  bundleIdentifier: "com.denizlg24.macros",
  developerName: "Deniz Lopes Günes",
  subtitle: "Food log, weight trend and adaptive targets.",
  localizedDescription:
    "Log food by search, barcode or nutrition label, follow your weight trend, and let weekly check-ins adjust your calorie and macro targets from your real energy expenditure.",
  iconURL,
  tintColor: "#111111",
  category: "lifestyle",
};
