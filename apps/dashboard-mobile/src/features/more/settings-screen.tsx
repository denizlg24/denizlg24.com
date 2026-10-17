import {
  Button,
  Stack as Gap,
  Hairline,
  haptics,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@repo/native-ui";
import {
  DASHBOARD_NOTIFICATION_GROUPS,
  DASHBOARD_NOTIFICATION_KINDS,
  DASHBOARD_NOTIFICATIONS,
  type DashboardNotificationKind,
  notificationEnabled,
} from "@repo/schemas";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";
import { forgetPush } from "@/features/notifications/push";
import { Segments } from "@/features/shell/segments";
import { auth } from "@/lib/auth";
import {
  setLocalSettings,
  setNotificationPrefs,
  useSettings,
} from "@/lib/settings";

const LEADS = ["5", "10", "15", "30"] as const;

function Toggle({ kind }: { kind: DashboardNotificationKind }) {
  const settings = useSettings();
  const on = notificationEnabled(settings.notifications, kind);
  return (
    <View>
      <View style={styles.toggle}>
        <Text style={{ flex: 1 }}>{DASHBOARD_NOTIFICATIONS[kind].label}</Text>
        <Switch
          value={on}
          onValueChange={(value) => {
            haptics.selection();
            setNotificationPrefs({ ...settings.notifications, [kind]: value });
          }}
        />
      </View>
      <Hairline />
    </View>
  );
}

function Lead({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (minutes: number) => void;
}) {
  return (
    <View style={styles.lead}>
      <Text variant="footnote" tone="secondary">
        {label}
      </Text>
      <Segments
        value={String(value)}
        onChange={(next) => onChange(Number(next))}
        options={LEADS.map((minutes) => ({
          value: minutes,
          label: `${minutes} min`,
        }))}
      />
    </View>
  );
}

export function SettingsScreen() {
  const settings = useSettings();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = () =>
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          await forgetPush();
          await auth.signOut();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: "Settings" }} />
      <Gap>
        {DASHBOARD_NOTIFICATION_GROUPS.map((group) => (
          <Section key={group} title={group}>
            {DASHBOARD_NOTIFICATION_KINDS.filter(
              (kind) => DASHBOARD_NOTIFICATIONS[kind].group === group,
            ).map((kind) => (
              <Toggle key={kind} kind={kind} />
            ))}
            {group === "Calendar" ? (
              <>
                <Lead
                  label="Event lead"
                  value={settings.local.eventLeadMinutes}
                  onChange={(eventLeadMinutes) =>
                    setLocalSettings({ ...settings.local, eventLeadMinutes })
                  }
                />
                <Lead
                  label="Class lead"
                  value={settings.local.classLeadMinutes}
                  onChange={(classLeadMinutes) =>
                    setLocalSettings({ ...settings.local, classLeadMinutes })
                  }
                />
              </>
            ) : null}
          </Section>
        ))}
        <Section title="App">
          <Row
            title="Version"
            value={Constants.expoConfig?.version ?? "—"}
            separator={false}
          />
        </Section>
        <Button
          label="Sign out"
          variant="destructive"
          loading={signingOut}
          onPress={signOut}
        />
      </Gap>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
  },
  lead: { paddingTop: spacing.md, gap: spacing.xs },
});
