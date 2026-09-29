import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Linking, Switch } from "react-native";
import { useProfile } from "@/api/profile";
import { getHealthState, useHealthState } from "@/features/health/health-state";
import {
  disableHealth,
  enableHealth,
  healthAvailable,
  syncHealth,
} from "@/features/health/sync";
import { haptics } from "@/lib/haptics";
import { InlineNotice, Row, Screen, Section, Text, VStack } from "@/ui";
import { NoticeSlot, useNotice } from "../shared/notice";

const READS = ["Weight", "Body fat", "Steps", "Active energy"];
const WRITES = ["Calories", "Protein", "Carbohydrates", "Fat"];

export function AppleHealthScreen() {
  const queryClient = useQueryClient();
  const timeZone = useProfile().data?.timezone;
  const { enabled, lastSyncedAt, lastError } = useHealthState();
  const { notice, showError, clear } = useNotice();
  const [busy, setBusy] = useState(false);
  const available = healthAvailable();

  async function run(task: () => Promise<void>) {
    clear();
    setBusy(true);
    try {
      await task();
      if (getHealthState().lastError) haptics.error();
      else haptics.success();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function toggle(next: boolean) {
    haptics.selection();
    if (!next) {
      disableHealth();
      return;
    }
    if (!timeZone) return;
    void run(() => enableHealth(queryClient, timeZone));
  }

  if (!available) {
    return (
      <Screen>
        <VStack>
          <Text variant="subheadline" tone="secondary">
            Apple Health isn’t available on this iPhone or in this build of
            Macros.
          </Text>
        </VStack>
      </Screen>
    );
  }

  return (
    <Screen stickyHeaderIndices={[0]}>
      <NoticeSlot notice={notice} onDismiss={clear} />
      <VStack>
        <Section footer="Macros syncs when you open it. Choose what it may read and write in the Health app.">
          <Row
            icon="heart-pulse"
            title="Sync with Health"
            trailing={
              <Switch
                value={enabled}
                disabled={busy || !timeZone}
                onValueChange={toggle}
              />
            }
            separator={enabled}
          />
          {enabled ? (
            <Row
              title={busy ? "Syncing…" : "Sync Now"}
              value={
                lastSyncedAt
                  ? formatDistanceToNow(lastSyncedAt, { addSuffix: true })
                  : undefined
              }
              disabled={busy || !timeZone}
              separator={false}
              onPress={() => {
                if (timeZone) void run(() => syncHealth(queryClient, timeZone));
              }}
            />
          ) : null}
        </Section>

        {enabled && lastError ? (
          <InlineNotice tone="error" message={lastError} />
        ) : null}

        <Section title="Reads">
          {READS.map((title, index) => (
            <Row
              key={title}
              title={title}
              separator={index < READS.length - 1}
            />
          ))}
        </Section>

        <Section
          title="Writes"
          footer="One daily total per nutrient, updated whenever you log."
        >
          {WRITES.map((title, index) => (
            <Row
              key={title}
              title={title}
              separator={index < WRITES.length - 1}
            />
          ))}
        </Section>

        <Section>
          <Row
            title="Open Health"
            chevron
            separator={false}
            onPress={() => void Linking.openURL("x-apple-health://")}
          />
        </Section>
      </VStack>
    </Screen>
  );
}
