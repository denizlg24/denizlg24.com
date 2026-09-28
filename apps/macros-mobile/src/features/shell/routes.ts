import type { NativeStackNavigationOptions } from "expo-router";
import { colors } from "@/ui/theme";

/** Every tab's own stack: large titles that collapse into the bar on scroll. */
export const tabStackOptions: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerLargeTitleShadowVisible: false,
  headerBackButtonDisplayMode: "minimal",
  contentStyle: { backgroundColor: colors.background },
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
};

/** A sheet that opens at half height and can be pulled to full. */
export const detentSheet: NativeStackNavigationOptions = {
  presentation: "formSheet",
  sheetAllowedDetents: [0.6, 1],
  sheetGrabberVisible: true,
  sheetExpandsWhenScrolledToEdge: true,
  headerShown: false,
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
