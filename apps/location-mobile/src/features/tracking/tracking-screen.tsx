import {
  type LocationAuthorization,
  LocationNative,
} from "@modules/location-native";
import type { LocationVisit } from "@repo/schemas";
import { Stack as RouterStack } from "expo-router";
import { Linking, View } from "react-native";
import { useCurrentLocation, useTodayVisits } from "@/api/location";
import { forgetPush } from "@/features/push/push";
import { auth } from "@/lib/auth";
import { accuracy, ago, clock, coordinates, duration } from "@/lib/format";
import {
  Button,
  Notice,
  Row,
  Screen,
  Section,
  Stack,
  spacing,
  Text,
} from "@/ui";
import { LiveModePicker } from "./live-mode-picker";
import { useTracker } from "./use-tracker";

const ACCESS: Record<LocationAuthorization, string> = {
  always: "Always",
  whenInUse: "While using",
  denied: "Denied",
  restricted: "Restricted",
  notDetermined: "Not asked",
  unknown: "Unknown",
};

function visitSubtitle(visit: LocationVisit) {
  const insight = visit.insight;
  if (insight && insight.reason !== "judging") {
    return insight.notified
      ? `${insight.title ?? ""} · ${insight.body ?? ""}`
      : `silent · ${insight.reason}`;
  }
  return coordinates(visit.latitude, visit.longitude);
}

export function TrackingScreen() {
  const { status, refresh, available } = useTracker();
  const current = useCurrentLocation();
  const visits = useTodayVisits();
  const refreshing = current.isRefetching || visits.isRefetching;

  const access = status?.authorization ?? "unknown";
  const blocked = access === "denied" || access === "restricted";
  const visit = current.data?.visit ?? null;
  const point = current.data?.point ?? null;

  return (
    <>
      <RouterStack.Screen
        options={{ title: "Location", headerLargeTitle: true }}
      />
      <Screen
        onRefresh={() => {
          void LocationNative?.flush();
          void refresh();
          void current.refetch();
          void visits.refetch();
        }}
        refreshing={refreshing}
      >
        <Stack>
          {!available ? (
            <Notice message="Native module missing (Expo Go)" />
          ) : null}

          <Section title="Now">
            {visit ? (
              <Row
                title={
                  visit.places[0]?.name ??
                  coordinates(visit.latitude, visit.longitude)
                }
                subtitle={`Since ${clock(visit.arrivedAt)} · ${accuracy(visit.horizontalAccuracy)}`}
                value={duration(
                  (Date.now() - Date.parse(visit.arrivedAt)) / 60_000,
                )}
              />
            ) : point ? (
              <Row
                title={coordinates(point.latitude, point.longitude)}
                subtitle={`${point.source} · ${accuracy(point.horizontalAccuracy)}`}
                value={ago(point.recordedAt)}
              />
            ) : (
              <Row title="—" />
            )}
            {current.error ? <Notice message={current.error.message} /> : null}
          </Section>

          <Section title="Tracking">
            <Row
              title="Access"
              value={ACCESS[access]}
              valueTone={access === "always" ? "working" : "secondary"}
            />
            {status && !status.precise && access !== "notDetermined" ? (
              <Row title="Precise" value="Off" />
            ) : null}
            {access === "notDetermined" || access === "whenInUse" ? (
              <View style={{ paddingVertical: spacing.md }}>
                <Button
                  label={access === "whenInUse" ? "Allow always" : "Allow"}
                  onPress={() => {
                    void LocationNative?.requestPermission().then(() =>
                      setTimeout(() => void refresh(), 500),
                    );
                  }}
                />
              </View>
            ) : null}
            {blocked ? (
              <View style={{ paddingVertical: spacing.md }}>
                <Button
                  label="Settings"
                  variant="tinted"
                  onPress={() => void Linking.openSettings()}
                />
              </View>
            ) : null}
            {status ? (
              <>
                <Text
                  variant="footnote"
                  tone="secondary"
                  style={{ marginTop: spacing.md }}
                >
                  Live trail
                </Text>
                <LiveModePicker
                  value={status.liveMode}
                  onChange={(mode) => {
                    void LocationNative?.setLiveMode(mode).then(refresh);
                  }}
                />
                <Row
                  title="Trail"
                  value={status.liveActive ? "Recording" : "Idle"}
                  valueTone={status.liveActive ? "working" : "secondary"}
                />
              </>
            ) : null}
          </Section>

          <Section title="Upload">
            <Row
              title="Queued"
              value={`${status?.pendingPoints ?? 0} · ${status?.pendingVisits ?? 0}`}
              subtitle="points · visits"
            />
            <Row
              title="Last upload"
              value={status?.lastUploadAt ? ago(status.lastUploadAt) : "—"}
              separator={!status?.lastError}
            />
            {status?.lastError ? <Notice message={status.lastError} /> : null}
          </Section>

          <Section title="Today">
            {visits.data?.visits.length ? (
              visits.data.visits
                .slice()
                .reverse()
                .map((entry) => (
                  <Row
                    key={entry.id}
                    title={`${clock(entry.arrivedAt)}–${entry.departedAt ? clock(entry.departedAt) : "now"}  ${entry.places[0]?.name ?? ""}`}
                    subtitle={visitSubtitle(entry)}
                    value={
                      entry.durationMinutes === null
                        ? duration(
                            (Date.now() - Date.parse(entry.arrivedAt)) / 60_000,
                          )
                        : duration(entry.durationMinutes)
                    }
                  />
                ))
            ) : (
              <Row title="—" />
            )}
            {visits.error ? <Notice message={visits.error.message} /> : null}
          </Section>

          <Button
            label="Sign out"
            variant="destructive"
            onPress={() => void forgetPush().then(() => auth.signOut())}
          />
        </Stack>
      </Screen>
    </>
  );
}
