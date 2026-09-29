import type { MacrosCaloriePreference } from "@repo/schemas/macros";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { Platform } from "react-native";
import { useProfile, useUpdateCaloriePreference } from "@/api/profile";
import { API_URL, APP_VERSION, capabilities, DEVICE_NAME } from "@/lib/config";
import { energyLabel } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { signOut } from "@/lib/session";
import { Row, Screen, Section, VStack } from "@/ui";
import { SegmentedControl } from "@/ui/segmented-control";
import { confirmDestructive } from "../shared/action-sheet";
import { NoticeSlot, useNotice } from "../shared/notice";

const PREFERENCES: readonly {
  value: MacrosCaloriePreference;
  label: string;
}[] = [
  { value: "remaining", label: "Remaining" },
  { value: "consumed", label: "Eaten" },
];

export function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const updatePreference = useUpdateCaloriePreference();
  const { notice, showError, clear } = useNotice();
  const [signingOut, setSigningOut] = useState(false);

  const data = profile.data;
  const preference = updatePreference.isPending
    ? updatePreference.variables
    : (data?.caloriePreference ?? "remaining");

  function confirmSignOut() {
    confirmDestructive({
      title: data ? `Signed in as ${data.email}` : undefined,
      message: "Anything logged while offline and not yet sent will be lost.",
      confirmLabel: "Sign Out",
      onConfirm: () => {
        setSigningOut(true);
        void signOut(queryClient).finally(() => setSigningOut(false));
      },
    });
  }

  return (
    <Screen stickyHeaderIndices={[0]}>
      <NoticeSlot notice={notice} onDismiss={clear} />
      <VStack>
        <Section
          title="Calories"
          footer="What the ring on Today counts: calories left for the day, or calories eaten so far."
        >
          <SegmentedControl
            values={PREFERENCES.map((entry) => entry.label)}
            selectedIndex={PREFERENCES.findIndex(
              (entry) => entry.value === preference,
            )}
            enabled={Boolean(data)}
            onChange={(event) => {
              const next = PREFERENCES[event.nativeEvent.selectedSegmentIndex];
              if (!next || next.value === preference) return;
              haptics.selection();
              clear();
              updatePreference.mutate(next.value, { onError: showError });
            }}
          />
        </Section>

        <Section title="Units" footer="Chosen when you signed up.">
          <Row title="Weight" value={data?.weightUnit ?? "—"} />
          <Row
            title="Energy"
            value={data ? energyLabel(data.energyUnit) : "—"}
            separator={false}
          />
        </Section>

        <Section
          title="Time zone"
          footer={`Follows this ${DEVICE_NAME}, so each day starts at your local midnight — even when you travel.`}
        >
          <Row
            title="Current"
            value={data?.timezone ?? "—"}
            separator={false}
          />
        </Section>

        {/* Both routes into Health are iOS only; Health Connect is not wired up. */}
        {Platform.OS === "ios" ? (
          <Section title="Apple Health">
            {capabilities.healthKit ? (
              <Row
                icon="heart-pulse"
                title="Sync with Health"
                subtitle="Weight, steps and active energy in; what you eat out."
                chevron
                onPress={() => router.push("/more/apple-health")}
              />
            ) : null}
            <Row
              icon={capabilities.healthKit ? "workflow" : "heart-pulse"}
              title="Import with Shortcuts"
              subtitle="Send weight and steps from Health automatically."
              chevron
              separator={false}
              onPress={() => router.push("/more/health-import")}
            />
          </Section>
        ) : null}

        <Section title="Notifications">
          <Row
            icon="bell"
            title="Reminders and summaries"
            chevron
            separator={false}
            onPress={() => router.push("/more/notifications")}
          />
        </Section>

        <Section title="Legal">
          <Row
            icon="hand"
            title="Privacy"
            chevron
            onPress={() => void openBrowserAsync(`${API_URL}/privacy`)}
          />
          <Row
            icon="file-text"
            title="Terms"
            chevron
            separator={false}
            onPress={() => void openBrowserAsync(`${API_URL}/terms`)}
          />
        </Section>

        <Section title="About">
          <Row title="Version" value={APP_VERSION} separator={false} />
        </Section>

        <Section>
          <Row
            icon="log-out"
            title={signingOut ? "Signing out…" : "Sign Out"}
            destructive
            disabled={signingOut}
            onPress={confirmSignOut}
          />
          <Row
            icon="trash"
            title="Delete Account"
            destructive
            separator={false}
            disabled={signingOut}
            onPress={() => router.push("/more/delete-account")}
          />
        </Section>
      </VStack>
    </Screen>
  );
}
