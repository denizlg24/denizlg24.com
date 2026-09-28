import { ActionSheetIOS } from "react-native";

export interface SheetAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

/** The system action sheet, with Cancel appended as the last option. */
export function showActionSheet({
  title,
  message,
  actions,
}: {
  title?: string;
  message?: string;
  actions: readonly SheetAction[];
}) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      message,
      options: [...actions.map((action) => action.label), "Cancel"],
      cancelButtonIndex: actions.length,
      destructiveButtonIndex: actions.flatMap((action, index) =>
        action.destructive ? [index] : [],
      ),
    },
    (index) => actions[index]?.onPress(),
  );
}

/** A single destructive confirmation, e.g. before deleting a recipe. */
export function confirmDestructive({
  title,
  message,
  confirmLabel,
  onConfirm,
}: {
  title?: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  showActionSheet({
    title,
    message,
    actions: [{ label: confirmLabel, destructive: true, onPress: onConfirm }],
  });
}
