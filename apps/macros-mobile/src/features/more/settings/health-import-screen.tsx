import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  HEALTH_IMPORT_WEBHOOK_URL,
  useCreateHealthImportToken,
} from "@/api/health-import";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  Flash,
  hairline,
  Screen,
  Section,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { NoticeSlot, useNotice } from "../shared/notice";

const EXAMPLE_BODY = `{
  "weighIns": [
    { "logDate": "2026-09-26", "weightKg": 81.4, "bodyFatPct": 18.2 }
  ],
  "activity": [
    { "logDate": "2026-09-26", "steps": 8421, "activeEnergyKcal": 512 }
  ]
}`;

const STEPS = [
  "Create a token below and keep it somewhere safe. It is shown only once.",
  "In Shortcuts, find your latest weight and today’s steps and active energy with “Find Health Samples”.",
  "Add “Get Contents of URL”: method POST, the URL below, a header Authorization with the value Bearer followed by a space and your token, and a JSON body shaped like the example.",
  "Make it a daily Personal Automation so it runs on its own.",
];

/** The label itself confirms the copy; there is nothing to dismiss. */
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      label={copied ? "Copied" : label}
      icon={copied ? "check" : "copy"}
      variant="tinted"
      size="regular"
      onPress={() => {
        void Clipboard.setStringAsync(value).then(() => {
          haptics.success();
          setCopied(true);
        });
      }}
    />
  );
}

export function HealthImportScreen() {
  const createToken = useCreateHealthImportToken();
  const { notice, showError, clear } = useNotice();
  const token = createToken.data?.token;

  function create() {
    clear();
    createToken.mutate(
      { source: "apple_shortcuts", label: "Apple Health Shortcut (iPhone)" },
      { onSuccess: () => haptics.success(), onError: showError },
    );
  }

  return (
    <Screen stickyHeaderIndices={[0]}>
      <NoticeSlot notice={notice} onDismiss={clear} />
      <VStack>
        <Text variant="subheadline" tone="secondary">
          Macros can’t read Apple Health directly. A Shortcut on this iPhone can
          send your weigh-ins and activity to Macros every day instead.
        </Text>

        <Section title="How to set it up">
          <View style={styles.steps}>
            {STEPS.map((step, index) => (
              <View key={step} style={styles.step}>
                <Text
                  variant="subheadline"
                  tone="secondary"
                  figure
                  style={styles.number}
                >
                  {index + 1}
                </Text>
                <Text variant="subheadline" style={styles.stepText}>
                  {step}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section
          title="Token"
          footer="Creating another token does not turn off the ones you already made."
        >
          {token ? (
            <Flash token={token} style={styles.tokenBlock}>
              <Text variant="footnote" weight="semibold">
                Copy this now — it won’t be shown again.
              </Text>
              <Text variant="callout" selectable style={styles.code}>
                {token}
              </Text>
              <CopyButton label="Copy Token" value={token} />
            </Flash>
          ) : (
            <Button
              label="Create Token"
              icon="key-round"
              loading={createToken.isPending}
              onPress={create}
            />
          )}
        </Section>

        <Section title="Shortcut URL">
          <View style={styles.tokenBlock}>
            <Text variant="callout" selectable style={styles.code}>
              {HEALTH_IMPORT_WEBHOOK_URL}
            </Text>
            <CopyButton label="Copy URL" value={HEALTH_IMPORT_WEBHOOK_URL} />
          </View>
        </Section>

        <Section
          title="Request body"
          footer="Both lists are optional and take up to 366 days each. Dates are YYYY-MM-DD and weight is in kilograms. An imported weigh-in never replaces one you logged for the same day; imported activity is kept apart from what you enter by hand."
        >
          <View style={styles.quote}>
            <Text variant="footnote" selectable style={styles.mono}>
              {EXAMPLE_BODY}
            </Text>
          </View>
        </Section>
      </VStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  steps: {
    gap: spacing.md,
  },
  step: {
    flexDirection: "row",
    gap: spacing.md,
  },
  number: {
    minWidth: 14,
  },
  stepText: {
    flex: 1,
  },
  tokenBlock: {
    gap: spacing.md,
  },
  code: {
    fontFamily: "Menlo",
  },
  quote: {
    borderLeftWidth: hairline * 2,
    borderLeftColor: colors.separator,
    paddingLeft: spacing.md,
  },
  mono: {
    fontFamily: "Menlo",
  },
});
