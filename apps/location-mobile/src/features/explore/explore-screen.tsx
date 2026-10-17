import {
  type LocationAuthorization,
  LocationNative,
} from "@modules/location-native";
import {
  Button,
  colors,
  haptics,
  Notice,
  PageHeader,
  Row,
  Screen,
  Section,
  Stack,
  spacing,
  Text,
} from "@repo/native-ui";
import type { LocationVisit } from "@repo/schemas";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useTodayVisits } from "@/api/location";
import { forgetPush } from "@/features/push/push";
import { auth } from "@/lib/auth";
import { ago, clock, distance, duration, elapsed } from "@/lib/format";
import { useTracker } from "./use-tracker";

const ACCESS: Record<LocationAuthorization, string> = {
  always: "Always",
  whenInUse: "While using",
  denied: "Denied",
  restricted: "Restricted",
  notDetermined: "Not asked",
  unknown: "Unknown",
};

const DETECTOR: Record<LocationVisit["source"], string> = {
  visit: "visit",
  geofence: "fence",
  stop: "stop",
};

function verdict(visit: LocationVisit) {
  const insight = visit.insight;
  if (!insight) return visit.places.length ? "waiting" : "no places";
  if (insight.reason === "judging") return "judging";
  return insight.notified
    ? `sent · ${insight.body ?? insight.title ?? ""}`
    : insight.reason;
}

function useTick(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** One switch: on when setting off, off on arrival. Nothing is recorded in between. */
export function ExploreScreen() {
  const { status, refresh, available } = useTracker();
  const visits = useTodayVisits();
  const [switching, setSwitching] = useState(false);
  const exploring = status?.exploring ?? false;
  const now = useTick(exploring);

  const access = status?.authorization ?? "unknown";
  const blocked = access === "denied" || access === "restricted";
  const startedAt = status?.startedAt ? Date.parse(status.startedAt) : null;
  const endedAt = status?.endedAt ? Date.parse(status.endedAt) : null;

  const toggle = async () => {
    if (!LocationNative || switching) return;
    setSwitching(true);
    haptics.impact();
    try {
      if (!exploring && access === "notDetermined") {
        await LocationNative.requestPermission();
      }
      await LocationNative.setExploring(!exploring);
      haptics.success();
    } finally {
      setSwitching(false);
      void refresh();
    }
  };

  return (
    <Screen
      onRefresh={() => {
        void LocationNative?.flush();
        void refresh();
        void visits.refetch();
      }}
    >
      <PageHeader title="Explore" />
      <Stack>
        {!available ? (
          <Notice message="Native module missing (Expo Go)" />
        ) : null}

        <View style={styles.hero}>
          <View style={styles.state}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: exploring
                    ? colors.accent
                    : colors.tertiaryLabel,
                },
              ]}
            />
            <Text variant="caption1" tone="secondary" eyebrow>
              {exploring
                ? `Exploring · since ${status?.startedAt ? clock(status.startedAt) : "—"}`
                : endedAt
                  ? `Off · last walk ${status?.endedAt ? ago(status.endedAt) : "—"}`
                  : "Off"}
            </Text>
          </View>
          <Text variant="largeTitle" style={styles.figure}>
            {exploring && startedAt
              ? elapsed(now - startedAt)
              : distance(status?.distanceMetres ?? 0)}
          </Text>
          <Text variant="subheadline" tone="secondary" figure>
            {exploring
              ? `${distance(status?.distanceMetres ?? 0)} · ${status?.sessionPoints ?? 0} points`
              : startedAt && endedAt
                ? `${elapsed(endedAt - startedAt)} · ${status?.sessionPoints ?? 0} points`
                : "—"}
          </Text>
          <Button
            label={exploring ? "Stop" : "Explore"}
            symbol={exploring ? "stop.fill" : "figure.walk"}
            variant={exploring ? "tinted" : "filled"}
            loading={switching}
            disabled={!available || blocked}
            onPress={() => void toggle()}
            style={styles.toggle}
          />
        </View>

        <Section title="Access">
          <Row
            title="Location"
            value={ACCESS[access]}
            valueTone={access === "always" ? "working" : "secondary"}
            separator={access === "always" && status?.precise !== false}
          />
          {status && !status.precise && access !== "notDetermined" ? (
            <Row title="Precise" value="Off" valueTone="destructive" />
          ) : null}
          {access === "notDetermined" || access === "whenInUse" ? (
            <Button
              label={access === "whenInUse" ? "Allow always" : "Allow"}
              variant="tinted"
              style={styles.inline}
              onPress={() => {
                void LocationNative?.requestPermission().then(() =>
                  setTimeout(() => void refresh(), 500),
                );
              }}
            />
          ) : null}
          {blocked ? (
            <Button
              label="Settings"
              variant="tinted"
              style={styles.inline}
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
        </Section>

        <Section
          title="Arrivals"
          trailing={
            <Text variant="caption1" tone="tertiary" figure>
              {status ? `${status.fencedShops} fenced` : ""}
            </Text>
          }
        >
          {visits.error ? <Notice message={visits.error.message} /> : null}
          {visits.data?.visits.length ? (
            visits.data.visits
              .slice()
              .reverse()
              .map((visit, index, rows) => (
                <Row
                  key={visit.id}
                  title={`${clock(visit.arrivedAt)}  ${visit.insight?.place || visit.places[0]?.name || "—"}`}
                  subtitle={`${DETECTOR[visit.source]} · ${verdict(visit)}`}
                  value={
                    visit.durationMinutes === null
                      ? undefined
                      : duration(visit.durationMinutes)
                  }
                  separator={index < rows.length - 1}
                />
              ))
          ) : (
            <Row title="—" separator={false} />
          )}
        </Section>

        <Section title="Upload">
          <Row
            title="Queued"
            value={`${status?.pendingPoints ?? 0} · ${status?.pendingVisits ?? 0}`}
            subtitle="points · arrivals"
          />
          <Row
            title="Last upload"
            value={status?.lastUploadAt ? ago(status.lastUploadAt) : "—"}
            separator={!status?.lastError}
          />
          {status?.lastError ? <Notice message={status.lastError} /> : null}
        </Section>

        <Button
          label="Sign out"
          variant="destructive"
          onPress={() => void forgetPush().then(() => auth.signOut())}
        />
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  state: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  figure: { fontSize: 56, lineHeight: 64, fontVariant: ["tabular-nums"] },
  toggle: { alignSelf: "stretch", marginTop: spacing.lg },
  inline: { marginVertical: spacing.md },
});
