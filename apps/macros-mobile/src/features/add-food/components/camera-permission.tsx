import { useCameraPermissions } from "expo-camera";
import type { ReactNode } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, colors, EmptyState, spacing } from "@/ui";

/**
 * Asks once, then explains. iOS never re-prompts after a refusal, and
 * Screen Time restrictions report the same way, so both lead to Settings
 * with a way to carry on without the camera.
 */
export function CameraPermissionGate({
  purpose,
  fallback,
  onClose,
  children,
}: {
  /** "scan barcodes", "photograph nutrition labels". */
  purpose: string;
  fallback: { label: string; onPress: () => void };
  onClose: () => void;
  children: ReactNode;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();

  if (permission?.granted) return children;

  const blocked = permission !== null && !permission.canAskAgain;

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + spacing.xl,
          paddingBottom: insets.bottom + spacing.xl,
        },
      ]}
    >
      {permission === null ? (
        <ActivityIndicator />
      ) : (
        <>
          <EmptyState
            icon={blocked ? "video-off" : "camera"}
            title={blocked ? "Camera access is off" : "Use the camera"}
            message={
              blocked
                ? `Macros needs the camera to ${purpose}. Turn it on in Settings, or continue without it.`
                : `Macros uses the camera to ${purpose}. Nothing is recorded or stored.`
            }
          />
          <View style={styles.actions}>
            {blocked ? (
              <Button
                label="Open Settings"
                onPress={() => void Linking.openSettings()}
              />
            ) : (
              <Button
                label="Allow camera"
                onPress={() => void requestPermission()}
              />
            )}
            <Button
              label={fallback.label}
              variant="tinted"
              onPress={fallback.onPress}
            />
            <Button label="Cancel" variant="plain" onPress={onClose} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.background,
  },
  actions: {
    gap: spacing.sm,
  },
});
