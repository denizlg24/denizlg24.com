import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./text";
import { colors, gutter, hairline, radius, spacing, typeScale } from "./theme";

// Android stands in for two iOS system surfaces with nothing close enough in
// React Native: ActionSheetIOS (Alert holds three buttons at most) and
// Alert.prompt (iOS only). One request at a time, like the system's own.

export interface DialogAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

type DialogRequest =
  | {
      kind: "sheet";
      title?: string;
      message?: string;
      actions: readonly DialogAction[];
    }
  | {
      kind: "prompt";
      title: string;
      message?: string;
      defaultValue: string;
      submitLabel: string;
      onSubmit: (value: string) => void;
    };

let current: DialogRequest | null = null;
const listeners = new Set<() => void>();

function publish(next: DialogRequest | null) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openDialog(request: DialogRequest) {
  publish(request);
}

/** Mounted once at the root on Android; renders whatever was opened. */
export function AndroidDialogHost() {
  const request = useSyncExternalStore(subscribe, () => current);
  const close = () => publish(null);

  return (
    <Modal
      visible={request !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      {request?.kind === "sheet" ? (
        <ActionSheet request={request} onClose={close} />
      ) : request?.kind === "prompt" ? (
        <Prompt request={request} onClose={close} />
      ) : null}
    </Modal>
  );
}

function ActionSheet({
  request,
  onClose,
}: {
  request: Extract<DialogRequest, { kind: "sheet" }>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const choose = (action: DialogAction) => {
    onClose();
    action.onPress();
  };

  return (
    <Pressable
      style={styles.scrim}
      onPress={onClose}
      accessibilityLabel="Cancel"
    >
      <Pressable
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}
      >
        {request.title || request.message ? (
          <View style={styles.header}>
            {request.title ? (
              <Text variant="footnote" weight="semibold" tone="secondary">
                {request.title}
              </Text>
            ) : null}
            {request.message ? (
              <Text variant="footnote" tone="secondary">
                {request.message}
              </Text>
            ) : null}
          </View>
        ) : null}
        {request.actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={() => choose(action)}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <Text tone={action.destructive ? "destructive" : "primary"}>
              {action.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
        >
          <Text weight="semibold">Cancel</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

function Prompt({
  request,
  onClose,
}: {
  request: Extract<DialogRequest, { kind: "prompt" }>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(request.defaultValue);
  useEffect(() => setValue(request.defaultValue), [request]);

  const submit = () => {
    onClose();
    request.onSubmit(value);
  };

  return (
    <View style={[styles.scrim, styles.centered]}>
      <View style={styles.prompt}>
        <Text variant="headline">{request.title}</Text>
        {request.message ? (
          <Text variant="footnote" tone="secondary">
            {request.message}
          </Text>
        ) : null}
        <TextInput
          value={value}
          onChangeText={setValue}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={submit}
          placeholderTextColor={colors.placeholder}
          style={styles.input}
        />
        <View style={styles.promptActions}>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <Text tone="secondary">Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={submit} hitSlop={8}>
            <Text weight="semibold">{request.submitLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  centered: {
    justifyContent: "center",
    padding: spacing.xxl,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm,
  },
  header: {
    gap: spacing.xxs,
    paddingHorizontal: gutter,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.separator,
  },
  option: {
    paddingHorizontal: gutter,
    paddingVertical: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.fill,
  },
  prompt: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  input: {
    ...typeScale.body,
    color: colors.label,
    paddingVertical: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.separator,
  },
  promptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xxl,
    paddingTop: spacing.sm,
  },
});
