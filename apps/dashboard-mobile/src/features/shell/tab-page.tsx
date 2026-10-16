import {
  HeaderButton,
  Notice,
  PageHeader,
  Screen,
  type ScreenProps,
  spacing,
  Text,
} from "@repo/native-ui";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

/**
 * A tab root: the large title, the tab's own actions, and the agent button
 * every tab carries, as the dock is on web.
 */
export function TabPage({
  title,
  actions,
  children,
  ...rest
}: ScreenProps & { title: string; actions?: ReactNode }) {
  const router = useRouter();
  return (
    <Screen {...rest}>
      <PageHeader title={title}>
        {actions}
        <HeaderButton
          symbol="sparkles"
          label="Agent"
          onPress={() => router.push("/chat")}
        />
      </PageHeader>
      {children}
    </Screen>
  );
}

/** The three states every query-backed surface has before its data. */
export function QueryState({
  error,
  loading,
}: {
  error: Error | null;
  loading: boolean;
}) {
  if (error) return <Notice message={error.message} />;
  if (loading) return <ActivityIndicator style={styles.pad} />;
  return null;
}

export function Dash() {
  return (
    <Text tone="tertiary" align="center" style={styles.pad}>
      —
    </Text>
  );
}

const styles = StyleSheet.create({
  pad: { paddingVertical: spacing.xxl },
});
