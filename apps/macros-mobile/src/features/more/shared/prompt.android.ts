import { openDialog } from "@/ui/android-dialogs";
import type * as Shared from "./prompt";

export type { PromptOptions } from "./prompt";

/** Alert.prompt is iOS only; the root's dialog host draws one. */
export const promptText: typeof Shared.promptText = ({
  title,
  message,
  defaultValue,
  submitLabel = "Save",
  onSubmit,
}) =>
  openDialog({
    kind: "prompt",
    title,
    message,
    defaultValue,
    submitLabel,
    onSubmit,
  });
