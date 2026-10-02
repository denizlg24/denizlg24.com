import type { NativeStackNavigationOptions } from "expo-router";
import { colors } from "@/ui/theme";

// On iOS the sheet's content stops above the bottom safe area, and only a
// background given here is painted on the screen beneath it — without it that
// strip shows the bare sheet, translucent on iOS 26. Android's sheet is
// otherwise bare, which leaves dark-mode text on a light sheet.
const sheetBackground: NativeStackNavigationOptions = {
  contentStyle: { backgroundColor: colors.background },
};

/** Every tab's own stack: large titles that collapse into the bar on scroll. */
export const tabStackOptions: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerLargeTitleShadowVisible: false,
  headerBackButtonDisplayMode: "minimal",
  contentStyle: { backgroundColor: colors.background },
};

/**
 * A tab's root screen: it draws its own title and actions (`PageHeader`) on
 * one row, so the native bar, which would sit empty above it, is hidden.
 * Pushed pages keep the native header for the back button.
 */
export const tabRootOptions: NativeStackNavigationOptions = {
  headerShown: false,
};

/**
 * A screen presented over the tabs. Presentation has to be declared on the
 * navigator before the screen is pushed, so each feature exports its modal
 * routes and `(app)/_layout.tsx` registers them all.
 */
export interface ModalRoute {
  /** Route name relative to `src/app/(app)`, e.g. `food/[id]`. */
  name: string;
  options: NativeStackNavigationOptions;
}

/** A sheet that sizes to its content — pickers, short forms. */
export const compactSheet: NativeStackNavigationOptions = {
  presentation: "formSheet",
  sheetAllowedDetents: "fitToContents",
  sheetGrabberVisible: true,
  headerShown: false,
  ...sheetBackground,
};

/** A sheet that opens at half height and can be pulled to full. */
export const detentSheet: NativeStackNavigationOptions = {
  presentation: "formSheet",
  sheetAllowedDetents: [0.6, 1],
  sheetGrabberVisible: true,
  sheetExpandsWhenScrolledToEdge: true,
  headerShown: false,
  ...sheetBackground,
};

/**
 * The food and recipe sheets: tall enough that the amount keypad leaves the
 * macros and the first nutrients in view.
 */
export const amountSheet: NativeStackNavigationOptions = {
  ...detentSheet,
  sheetAllowedDetents: [0.9, 1],
};

/** A full form with its own header (Cancel / Save). */
export const formModal: NativeStackNavigationOptions = {
  presentation: "modal",
  headerShown: true,
};

/** Camera surfaces: nothing behind them should be visible. */
export const cameraModal: NativeStackNavigationOptions = {
  presentation: "fullScreenModal",
  headerShown: false,
  animation: "slide_from_bottom",
};

/** What the tab bar's "+" opens. */
export const shellModalRoutes: ModalRoute[] = [
  { name: "shortcuts", options: compactSheet },
];
