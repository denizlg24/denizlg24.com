import {
  Stack as Gap,
  haptics,
  Notice,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@repo/native-ui";
import { formatMoney } from "@repo/utils";
import { Stack } from "expo-router";
import { ActionSheetIOS, StyleSheet, View } from "react-native";
import { useFinance, useUpdateEntry } from "@/api/money";
import { QueryState } from "@/features/shell/tab-page";
import { dayLabel } from "@/lib/format";

/** One ledger row: what it was, and the category it is filed under. */
export function EntryScreen({ id }: { id: string }) {
  const finance = useFinance();
  const update = useUpdateEntry();
  const entry = finance.data?.ledger.find((row) => row.id === id);
  const account = finance.data?.accounts.find(
    (row) => row.id === entry?.accountId,
  );

  const recategorize = (category: string | null) => {
    if (!entry) return;
    const apply = (applyToMerchant: boolean) => {
      haptics.selection();
      update.mutate({ id, update: { category, applyToMerchant } });
    };
    if (!entry.merchantFingerprint) {
      apply(false);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["This one", "Everything from this merchant", "Cancel"],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) apply(false);
        if (index === 1) apply(true);
      },
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: "" }} />
      <QueryState error={finance.error} loading={!finance.data} />
      {update.error ? <Notice message={update.error.message} /> : null}
      {entry ? (
        <Gap>
          <View style={styles.head}>
            <Text variant="largeTitle" figure>
              {formatMoney(entry.amountMinor, entry.currency)}
            </Text>
            <Text variant="title3">{entry.descriptor}</Text>
            <Text variant="subheadline" tone="secondary">
              {[
                dayLabel(entry.effectiveDate),
                account?.displayName,
                `${entry.origin} · ${entry.state}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {entry.origin === "manual" && entry.note ? (
              <Text variant="body">{entry.note}</Text>
            ) : null}
          </View>
          <Section title="Category">
            <Row
              title="None"
              value={entry.category ? undefined : "✓"}
              onPress={() => recategorize(null)}
            />
            {(finance.data?.categories ?? []).map((category, index, rows) => (
              <Row
                key={category.id}
                title={category.name}
                value={entry.category === category.name ? "✓" : undefined}
                separator={index < rows.length - 1}
                onPress={() =>
                  entry.category !== category.name &&
                  recategorize(category.name)
                }
              />
            ))}
          </Section>
        </Gap>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ head: { gap: spacing.xs } });
