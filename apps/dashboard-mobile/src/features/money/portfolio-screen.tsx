import {
  colors,
  Stack as Gap,
  HeaderButton,
  haptics,
  Notice,
  Row,
  Screen,
  Section,
  Stat,
  spacing,
  Text,
} from "@repo/native-ui";
import type { Order } from "@repo/schemas/markets";
import { Stack, useRouter } from "expo-router";
import { ActionSheetIOS, StyleSheet, View } from "react-native";
import {
  useCancelOrder,
  useOrders,
  usePerformance,
  usePortfolios,
} from "@/api/money";
import { Dash, QueryState } from "@/features/shell/tab-page";
import { signedPercent, usd } from "./quotes";

function describeOrder(order: Order) {
  const price =
    order.type === "limit"
      ? ` @ ${order.limitPrice}`
      : order.type === "stop"
        ? ` stop ${order.stopPrice}`
        : order.type === "stop_limit"
          ? ` stop ${order.stopPrice} @ ${order.limitPrice}`
          : order.type === "trailing_stop"
            ? ` trail ${order.trailBasis === "percent" ? `${(order.trailValue ?? 0) * 100}%` : order.trailValue}`
            : "";
  return `${order.side} ${order.quantity} ${order.type.replace("_", " ")}${price}`;
}

export function PortfolioScreen({ id }: { id: string }) {
  const router = useRouter();
  const portfolios = usePortfolios();
  const performance = usePerformance(id);
  const orders = useOrders(id);
  const cancel = useCancelOrder(id);
  const portfolio = portfolios.data?.find((row) => row.id === id);
  const data = performance.data;

  const askCancel = (order: Order) =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${order.ticker} · ${describeOrder(order)}`,
        options: ["Cancel order", "Keep"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index !== 0) return;
        haptics.warning();
        cancel.mutate(order.id);
      },
    );

  return (
    <Screen
      onRefresh={() => {
        void performance.refetch();
        void orders.refetch();
      }}
      refreshing={performance.isRefetching}
    >
      <Stack.Screen
        options={{
          title: portfolio?.name ?? "",
          headerRight: () => (
            <HeaderButton
              symbol="plus"
              label="Order"
              onPress={() => router.push(`/order?portfolio=${id}`)}
            />
          ),
        }}
      />
      <QueryState error={performance.error} loading={!data} />
      {cancel.error ? <Notice message={cancel.error.message} /> : null}
      {data ? (
        <Gap>
          <View style={styles.head}>
            <Text variant="largeTitle" figure>
              {usd(data.metrics.totalValue)}
            </Text>
            <Text
              variant="subheadline"
              figure
              tone={(data.metrics.dayPnl ?? 0) >= 0 ? "working" : "destructive"}
            >
              {data.metrics.dayPnl === null
                ? "—"
                : `${usd(data.metrics.dayPnl)} today (${signedPercent(data.metrics.dayPnlPercent)})`}
            </Text>
          </View>
          <View style={styles.stats}>
            <Stat label="Total P&L" value={usd(data.metrics.totalPnl, 0)} />
            <Stat label="Cash" value={usd(data.metrics.cash, 0)} />
            <Stat
              label="Buying power"
              value={usd(data.margin.buyingPower, 0)}
            />
          </View>
          {data.margin.marginCall ? (
            <Notice
              message={`Margin call: ${usd(data.margin.marginCallAmount)} short`}
            />
          ) : null}

          <Section title="Positions">
            {data.positions.length === 0 ? <Dash /> : null}
            {data.positions.map((position, index) => (
              <Row
                key={position.ticker}
                title={`${position.ticker}${position.side === "short" ? " · short" : ""}`}
                subtitle={`${position.quantity} @ ${position.avgCost.toFixed(2)} · ${signedPercent(position.unrealizedPnlPercent)}`}
                value={usd(position.marketValue, 0)}
                valueTone="primary"
                separator={index < data.positions.length - 1}
                onPress={() =>
                  router.push(
                    `/order?portfolio=${id}&ticker=${position.ticker}`,
                  )
                }
              />
            ))}
          </Section>

          <Section title="Working orders">
            <QueryState error={orders.error} loading={!orders.data} />
            {orders.data?.length === 0 ? <Dash /> : null}
            {orders.data?.map((order, index, rows) => (
              <Row
                key={order.id}
                title={order.ticker}
                subtitle={describeOrder(order)}
                value={order.status}
                separator={index < rows.length - 1}
                onPress={() => askCancel(order)}
              />
            ))}
          </Section>
        </Gap>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.xxs },
  stats: {
    flexDirection: "row",
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingTop: spacing.md,
  },
});
