import type {
  MacrosDistributionBuildDispatch,
  MacrosDistributionRequestStatus,
} from "@repo/schemas/macros";
import { formatDistanceToNowStrict } from "date-fns";
import { Pressable, StyleSheet, View } from "react-native";
import {
  type DeviceRequest,
  useDecideDeviceRequest,
  useDeviceRequests,
} from "@/api/distribution";
import { haptics } from "@/lib/haptics";
import {
  colors,
  EmptyState,
  gutter,
  Hairline,
  Screen,
  type SwipeAction,
  SwipeRow,
  spacing,
  Text,
} from "@/ui";
import { confirmDestructive, showActionSheet } from "../shared/action-sheet";
import { ListSection } from "../shared/list-rows";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";

const groups: { status: MacrosDistributionRequestStatus; title: string }[] = [
  { status: "pending", title: "Pending" },
  { status: "approved", title: "Approved" },
  { status: "declined", title: "Declined" },
];

const buildNotice: Record<MacrosDistributionBuildDispatch, string | null> = {
  triggered: "Approved. Ad-hoc build started.",
  "not-configured": "Approved. No build started: dispatch token unset.",
  failed: "Approved. Build dispatch failed.",
  "not-applicable": null,
};

function age(iso: string) {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

function metaLine(request: DeviceRequest) {
  return [
    age(request.createdAt),
    request.registeredAt ? "registered" : null,
    request.installableAt ? "installable" : null,
    request.notifiedAt ? "notified" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export function DeviceRequestsScreen() {
  const requests = useDeviceRequests();
  const decide = useDecideDeviceRequest();
  const { notice, show, showError, clear } = useNotice();
  const { refreshing, onRefresh } = useRefresh(requests.refetch);

  function approve(request: DeviceRequest) {
    decide.mutate(
      { id: request.id, action: "approve" },
      {
        onSuccess: ({ build }) => {
          haptics.success();
          const message = buildNotice[build];
          if (message) {
            show({ message, tone: build === "triggered" ? "info" : "error" });
          }
        },
        onError: showError,
      },
    );
  }

  function decline(request: DeviceRequest) {
    confirmDestructive({
      title: `Decline ${request.name}?`,
      message: request.registeredAt
        ? "The UDID stays registered with Apple until the membership year ends."
        : undefined,
      confirmLabel: "Decline",
      onConfirm: () =>
        decide.mutate(
          { id: request.id, action: "decline" },
          { onSuccess: () => haptics.success(), onError: showError },
        ),
    });
  }

  function actionsFor(request: DeviceRequest) {
    const approveAction: SwipeAction = {
      label: request.status === "approved" ? "Rebuild" : "Approve",
      icon: "check",
      onPress: () => approve(request),
    };
    const declineAction: SwipeAction = {
      label: "Decline",
      icon: "x",
      destructive: true,
      onPress: () => decline(request),
    };
    return {
      leading: [approveAction],
      trailing: request.status === "declined" ? [] : [declineAction],
    };
  }

  const all = requests.data ?? [];
  const empty = requests.data !== undefined && all.length === 0;

  return (
    <Screen
      bleed
      stickyHeaderIndices={[0]}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <NoticeSlot notice={notice} onDismiss={clear} inset />
      {empty ? <EmptyState icon="inbox" title="No requests" /> : null}
      {groups.map(({ status, title }) => {
        const rows = all.filter((request) => request.status === status);
        if (rows.length === 0) return null;
        return (
          <ListSection key={status} title={`${title} · ${rows.length}`}>
            {rows.map((request) => {
              const { leading, trailing } = actionsFor(request);
              return (
                <SwipeRow
                  key={request.id}
                  leadingActions={leading}
                  actions={trailing}
                >
                  <DeviceRequestRow
                    request={request}
                    onLongPress={() =>
                      showActionSheet({
                        title: request.name,
                        actions: [...leading, ...trailing].map((action) => ({
                          label: action.label,
                          destructive: action.destructive,
                          onPress: action.onPress,
                        })),
                      })
                    }
                  />
                </SwipeRow>
              );
            })}
          </ListSection>
        );
      })}
    </Screen>
  );
}

function DeviceRequestRow({
  request,
  onLongPress,
}: {
  request: DeviceRequest;
  onLongPress: () => void;
}) {
  return (
    <View>
      <Pressable
        onLongPress={onLongPress}
        accessibilityHint="Long press for actions"
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: colors.fill },
        ]}
      >
        <View style={styles.heading}>
          <Text variant="body" numberOfLines={1} style={styles.name}>
            {request.name}
          </Text>
          <Text variant="footnote" tone="secondary" figure numberOfLines={1}>
            {metaLine(request)}
          </Text>
        </View>
        <Text variant="subheadline" tone="secondary" numberOfLines={1}>
          {request.email}
        </Text>
        <Text
          variant="footnote"
          tone="secondary"
          selectable
          numberOfLines={1}
          style={styles.udid}
        >
          {request.udid}
        </Text>
        {request.note ? (
          <Text variant="footnote" numberOfLines={3}>
            {request.note}
          </Text>
        ) : null}
        {request.lastError ? (
          <Text variant="footnote" tone="destructive" numberOfLines={3}>
            {request.lastError}
          </Text>
        ) : null}
      </Pressable>
      <Hairline inset={gutter} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xxs,
    paddingHorizontal: gutter,
    paddingVertical: spacing.md,
  },
  heading: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  name: {
    flex: 1,
  },
  udid: {
    fontFamily: "Menlo",
    fontVariant: ["tabular-nums"],
  },
});
