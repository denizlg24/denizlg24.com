import { Alert } from "react-native";

export interface PromptOptions {
  title: string;
  message?: string;
  defaultValue: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
}

/** The system text prompt: Cancel, then the submit button. */
export function promptText({
  title,
  message,
  defaultValue,
  submitLabel = "Save",
  onSubmit,
}: PromptOptions) {
  Alert.prompt(
    title,
    message,
    [
      { text: "Cancel", style: "cancel" },
      { text: submitLabel, onPress: (value?: string) => onSubmit(value ?? "") },
    ],
    "plain-text",
    defaultValue,
  );
}
