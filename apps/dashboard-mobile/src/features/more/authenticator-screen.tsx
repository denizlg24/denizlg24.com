import { colors, haptics, Screen, spacing, Text } from "@repo/native-ui";
import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAuthenticatorAccounts, useAuthenticatorCodes } from "@/api/more";
import { Dash, QueryState } from "@/features/shell/tab-page";

function grouped(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/**
 * Codes the server computed. The phone never holds a secret: the export
 * route is not called from this app, and codes never reach a widget or a
 * notification.
 */
export function AuthenticatorScreen() {
  const accounts = useAuthenticatorAccounts();
  const codes = useAuthenticatorCodes();
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.floor((now - codes.dataUpdatedAt) / 1_000);
  const byId = new Map((codes.data ?? []).map((code) => [code._id, code]));
  return (
    <Screen>
      <Stack.Screen options={{ title: "Authenticator" }} />
      <QueryState
        error={accounts.error ?? codes.error}
        loading={!accounts.data || !codes.data}
      />
      {accounts.data?.length === 0 ? <Dash /> : null}
      {accounts.data?.map((account) => {
        const code = byId.get(account._id);
        const remaining = code ? Math.max(0, code.remaining - elapsed) : 0;
        return (
          <Pressable
            key={account._id}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${account.label}`}
            onPress={async () => {
              if (!code) return;
              await Clipboard.setStringAsync(code.code);
              haptics.success();
              setCopied(account._id);
              setTimeout(() => setCopied(null), 1_500);
            }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.55 }]}
          >
            <View style={styles.label}>
              <Text variant="subheadline" numberOfLines={1}>
                {account.issuer || account.label}
              </Text>
              <Text variant="footnote" tone="secondary" numberOfLines={1}>
                {account.accountName}
              </Text>
            </View>
            <View style={styles.code}>
              <Text variant="title2" figure>
                {copied === account._id
                  ? "Copied"
                  : code
                    ? grouped(code.code)
                    : "—"}
              </Text>
              {code ? (
                <Text
                  variant="caption1"
                  figure
                  tone={remaining <= 5 ? "destructive" : "tertiary"}
                >
                  {remaining}s
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  label: { flex: 1, gap: 2 },
  code: { alignItems: "flex-end" },
});
