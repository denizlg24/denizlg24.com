import * as Haptics from "expo-haptics";

// Fire-and-forget: a haptic that fails (Low Power Mode, older hardware) must
// never surface as an error in the flow that triggered it.
function ignore(promise: Promise<void>) {
  promise.catch(() => undefined);
}

// Long enough that the success pattern has finished and the second tap reads
// as its own beat.
const GOAL_REACHED_GAP_MS = 260;

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
  /** A swipe action crossing its threshold, a barcode read. */
  impact: () => ignore(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Staging on the plate, pull to refresh. */
  light: () => ignore(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** In place of `success` for the log that first crosses a day's target. */
  goalReached: () => {
    ignore(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    setTimeout(
      () => ignore(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
      GOAL_REACHED_GAP_MS,
    );
  },
};
