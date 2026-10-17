import {
  colors,
  Field,
  haptics,
  Notice,
  parseDecimal,
  spacing,
} from "@repo/native-ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Button, ScrollView, StyleSheet } from "react-native";
import { type OrderDraft, usePlaceOrder } from "@/api/money";
import { Segments } from "@/features/shell/segments";

type Side = "buy" | "sell";
type Kind = "market" | "limit" | "stop";
type Tif = "day" | "gtc";

/** Simulated fills on the markets cron; nothing here reaches a broker. */
export default function OrderSheet() {
  const params = useLocalSearchParams<{ portfolio: string; ticker?: string }>();
  const router = useRouter();
  const place = usePlaceOrder(params.portfolio);
  const [ticker, setTicker] = useState(params.ticker ?? "");
  const [side, setSide] = useState<Side>("buy");
  const [kind, setKind] = useState<Kind>("market");
  const [tif, setTif] = useState<Tif>("day");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");

  const qty = parseDecimal(quantity);
  const level = parseDecimal(price);
  const symbol = ticker.trim().toUpperCase();
  const ready =
    symbol.length > 0 &&
    qty !== null &&
    qty > 0 &&
    (kind === "market" || (level !== null && level > 0));

  const submit = () => {
    if (!ready || qty === null) return;
    const order: OrderDraft = {
      ticker: symbol,
      side,
      type: kind,
      quantity: qty,
      limitPrice: kind === "limit" ? level : null,
      stopPrice: kind === "stop" ? level : null,
      timeInForce: tif,
    };
    const label = `${side === "buy" ? "Buy" : "Sell"} ${qty} ${symbol}${kind === "market" ? "" : ` ${kind} ${level}`}`;
    Alert.alert(label, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Place",
        onPress: () =>
          place.mutate(order, {
            onSuccess: () => {
              haptics.success();
              router.back();
            },
          }),
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: "Order",
          headerRight: () => (
            <Button
              title="Review"
              disabled={!ready || place.isPending}
              onPress={submit}
            />
          ),
        }}
      />
      {place.error ? <Notice message={place.error.message} /> : null}
      <Segments
        value={side}
        onChange={setSide}
        options={[
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
        ]}
      />
      <Field
        label="Symbol"
        value={ticker}
        onChangeText={setTicker}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus={!params.ticker}
      />
      <Field
        label="Quantity"
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="decimal-pad"
        figure
        autoFocus={Boolean(params.ticker)}
      />
      <Segments
        value={kind}
        onChange={setKind}
        options={[
          { value: "market", label: "Market" },
          { value: "limit", label: "Limit" },
          { value: "stop", label: "Stop" },
        ]}
      />
      {kind === "market" ? null : (
        <Field
          label={kind === "limit" ? "Limit" : "Stop"}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          figure
        />
      )}
      <Segments
        value={tif}
        onChange={setTif}
        options={[
          { value: "day", label: "Day" },
          { value: "gtc", label: "Until cancelled" },
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
});
