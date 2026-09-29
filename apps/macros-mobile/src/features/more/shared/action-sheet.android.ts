import { openDialog } from "@/ui/android-dialogs";
import type * as Shared from "./action-sheet";

export type { SheetAction } from "./action-sheet";

/** Android has no system action sheet; the root's dialog host draws one. */
export const showActionSheet: typeof Shared.showActionSheet = ({
  title,
  message,
  actions,
}) => openDialog({ kind: "sheet", title, message, actions });

export const confirmDestructive: typeof Shared.confirmDestructive = ({
  title,
  message,
  confirmLabel,
  onConfirm,
}) =>
  showActionSheet({
    title,
    message,
    actions: [{ label: confirmLabel, destructive: true, onPress: onConfirm }],
  });
