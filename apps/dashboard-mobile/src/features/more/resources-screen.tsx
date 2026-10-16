import {
  Stack as Gap,
  Row,
  Screen,
  Section,
  spacing,
  Text,
} from "@repo/native-ui";
import type { IResource } from "@repo/schemas";
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { View } from "react-native";
import { useResources, useSubResources } from "@/api/more";
import { Dash, QueryState } from "@/features/shell/tab-page";
import { StatusDot } from "@/features/today/status";
import { ago } from "@/lib/format";

const STATUS_PAGE = "https://status.denizlg24.com";

function uptime(value: number | undefined) {
  return value === undefined ? undefined : `${value.toFixed(2)}%`;
}

function SubResources({ resource }: { resource: IResource }) {
  const subs = useSubResources(resource._id);
  if (!subs.data || subs.data.length === 0) return null;
  return (
    <View style={{ paddingLeft: spacing.lg }}>
      {subs.data.map((sub) => (
        <Row
          key={sub._id}
          title={sub.name}
          subtitle={
            sub.lastResponseTimeMs !== null
              ? `${sub.lastResponseTimeMs} ms`
              : undefined
          }
          value={uptime(sub.uptime?.uptimePercentage)}
          trailing={
            <StatusDot
              status={
                sub.lastStatus === "healthy"
                  ? "healthy"
                  : sub.lastStatus === "unhealthy"
                    ? "unreachable"
                    : null
              }
            />
          }
        />
      ))}
    </View>
  );
}

export function ResourcesScreen() {
  const resources = useResources();
  const active = resources.data?.filter((item) => item.isActive) ?? [];
  return (
    <Screen
      onRefresh={() => void resources.refetch()}
      refreshing={resources.isRefetching}
    >
      <Stack.Screen options={{ title: "Resources" }} />
      <QueryState error={resources.error} loading={!resources.data} />
      {resources.data && active.length === 0 ? <Dash /> : null}
      <Gap>
        {active.map((resource) => (
          <Section key={resource._id} title={resource.type}>
            <Row
              title={resource.name}
              subtitle={
                resource.agentService.lastCheckedAt
                  ? `checked ${ago(resource.agentService.lastCheckedAt)}`
                  : undefined
              }
              value={uptime(resource.uptime?.uptimePercentage)}
              trailing={<StatusDot status={resource.agentService.lastStatus} />}
            />
            {resource.uptime && resource.uptime.outages.length > 0 ? (
              <Text
                variant="footnote"
                tone="secondary"
                style={{ paddingVertical: spacing.xs }}
              >
                {resource.uptime.outages.length} outages in the window
              </Text>
            ) : null}
            <SubResources resource={resource} />
          </Section>
        ))}
        <Row
          title="Status page"
          chevron
          separator={false}
          onPress={() => void WebBrowser.openBrowserAsync(STATUS_PAGE)}
        />
      </Gap>
    </Screen>
  );
}
