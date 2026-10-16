import * as Haptics from "expo-haptics";

// Fire-and-forget: a haptic that fails (Low Power Mode, older hardware) must
// never surface as an error in the flow that triggered it.
function ignore(promise: Promise<void>) {
  promise.catch(() => undefined);
}

export const haptics = {
  /** Something was logged or saved. */
  success: () =>
    ignore(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () =>
    ignore(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () =>
    ignore(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** A picker value, a segment, a stepper tick. */
  selection: () => ignore(Haptics.selectionAsync()),
  /** Checking in or out. */
  impact: () => ignore(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Pull to refresh. */
  light: () => ignore(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
