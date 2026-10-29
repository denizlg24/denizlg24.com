"use client";

import { initialRequirementFor } from "@repo/markets/core";
import type {
  MarginConfig,
  MarginState,
  OrderInput,
  OrderType,
  Position,
  Quote,
  TimeInForce,
} from "@repo/markets/schemas";
import { Button } from "@repo/ui/button";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { money, trimQuantity } from "./format";
import { SymbolSearch } from "./symbol-search";
import {
  FractionBar,
  Preview,
  PreviewRow,
  SizeField,
  TickerLine,
  TicketNotices,
} from "./ticket-fields";

/** Shares, or an amount of money converted to shares at the working price. */
type SizingMode = "shares" | "value";

const TYPE_LABELS: Record<OrderType, string> = {
  market: "Market",
  limit: "Limit",
  stop: "Stop",
  stop_limit: "Stop limit",
  trailing_stop: "Trailing",
};

const TIF_LABELS: Record<TimeInForce, string> = {
  day: "Day",
  gtc: "GTC",
  gtd: "GTD",
};

export interface OrderTicketProps {
  baseCurrency: string;
  positions: Position[];
  margin: MarginState;
  marginConfig: MarginConfig;
  allowShorts: boolean;
  /** Locks the ticket to one symbol — the quick-trade case from a chart. */
  fixedTicker?: string;
  initialPrice?: number | null;
  initialSide?: "buy" | "sell";
  onSubmit: (input: OrderInput) => Promise<void>;
  onDone?: () => void;
}

/**
 * The order entry surface. Side and size are the only things always on screen;
 * the price fields follow the type, so the ticket never shows a stop field for
 * an order that has no stop.
 *
 * Everything below the fields is a preview of what the engine will do with the
 * order — what it closes, what it opens, what it costs against buying power —
 * computed with the same rules the server admits it by.
 */
export function OrderTicket({
  baseCurrency,
  positions,
  margin,
  marginConfig,
  allowShorts,
  fixedTicker,
  initialPrice = null,
  initialSide = "buy",
  onSubmit,
  onDone,
}: OrderTicketProps) {
  const { client } = useAdmin();
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [type, setType] = useState<OrderType>("market");
  const [ticker, setTicker] = useState(fixedTicker ?? "");
  const [sizing, setSizing] = useState<SizingMode>("shares");
  const [quantity, setQuantity] = useState("");
  const [value, setValue] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [trailBasis, setTrailBasis] = useState<"amount" | "percent">("percent");
  const [trailValue, setTrailValue] = useState("5");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("gtc");
  const [expiresAt, setExpiresAt] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [fees, setFees] = useState("");
  const [note, setNote] = useState("");
  const [bracket, setBracket] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [last, setLast] = useState<number | null>(initialPrice);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const held = useMemo(
    () => positions.find((position) => position.ticker === ticker) ?? null,
    [positions, ticker],
  );

  // Unlike the trade ticket there is no editable price to protect here: `last`
  // is a read-only reference, and the levels the owner types live in their own
  // fields, so the streaming quote can always win.
  useEffect(() => {
    if (initialPrice != null) setLast(initialPrice);
  }, [initialPrice]);

  const pickTicker = useCallback(
    (next: string) => {
      const upper = next.toUpperCase();
      setTicker(upper);
      client
        .get<{ quotes: Quote[] }>(
          `/markets/quotes?tickers=${encodeURIComponent(upper)}`,
        )
        .then((data) => {
          const quote = data.quotes[0]?.last;
          if (quote != null) setLast(quote);
        })
        .catch(() => undefined);
    },
    [client],
  );

  // The price the order is expected to work at. A limit works at its limit, a
  // stop at its stop; everything else at the last print. Sizing by value and the
  // cost preview both hang off this, so it has to follow the type.
  const working = useMemo(() => {
    if (type === "limit" || type === "stop_limit")
      return Number(limitPrice) || 0;
    if (type === "stop") return Number(stopPrice) || 0;
    return last ?? 0;
  }, [type, limitPrice, stopPrice, last]);

  const shares = useMemo(() => {
    if (sizing === "shares") return Number(quantity) || 0;
    const amount = Number(value) || 0;
    // Rounded here rather than in the preview. 100 against a working price of 3
    // is 33.333333333333336 shares, and previewing 33.3333 while submitting the
    // full float places an order for a size the ticket never showed.
    return working > 0 ? Number((amount / working).toFixed(4)) : 0;
  }, [sizing, quantity, value, working]);

  // How the order lands against the book, mirroring the engine's own split.
  const { closing, opening } = useMemo(() => {
    const position = held?.quantity ?? 0;
    const signed = side === "buy" ? shares : -shares;
    const opposed = position !== 0 && Math.sign(signed) !== Math.sign(position);
    const close = opposed ? Math.min(shares, Math.abs(position)) : 0;
    return { closing: close, opening: shares - close };
  }, [held, side, shares]);

  const notional = shares * working;
  // Only the opening portion costs margin — closing exposure frees it. Computed
  // with the same helper the server admits the order by, so the preview and the
  // rejection cannot disagree.
  const requirement = useMemo(
    () =>
      opening <= 0
        ? 0
        : initialRequirementFor(
            side === "buy" ? "long" : "short",
            opening * working,
            marginConfig,
          ),
    [opening, working, side, marginConfig],
  );

  const willShort = side === "sell" && (held?.quantity ?? 0) - shares < 0;
  const overBuyingPower = requirement > margin.buyingPower;

  const applyFraction = useCallback(
    (fraction: number) => {
      // Closing an existing position sizes off the position; opening a new one
      // sizes off what can actually be committed.
      const position = held?.quantity ?? 0;
      const closes =
        (side === "sell" && position > 0) || (side === "buy" && position < 0);
      if (closes) {
        setSizing("shares");
        setQuantity(trimQuantity(Math.abs(position) * fraction));
        return;
      }
      setSizing("value");
      setValue((margin.buyingPower * fraction).toFixed(2));
    },
    [held, side, margin.buyingPower],
  );

  const submit = useCallback(async () => {
    if (!ticker) {
      setProblem("Pick a symbol");
      return;
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      setProblem("Size must be positive");
      return;
    }
    if (
      (type === "limit" || type === "stop_limit") &&
      !(Number(limitPrice) > 0)
    ) {
      setProblem("Limit price must be positive");
      return;
    }
    if (
      (type === "stop" || type === "stop_limit") &&
      !(Number(stopPrice) > 0)
    ) {
      setProblem("Stop price must be positive");
      return;
    }
    if (type === "trailing_stop" && !(Number(trailValue) > 0)) {
      setProblem("Trail distance must be positive");
      return;
    }
    if (timeInForce === "gtd" && !expiresAt) {
      setProblem("Pick an expiry");
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await onSubmit({
        ticker,
        side,
        type,
        quantity: shares,
        limitPrice:
          type === "limit" || type === "stop_limit" ? Number(limitPrice) : null,
        stopPrice:
          type === "stop" || type === "stop_limit" ? Number(stopPrice) : null,
        trailBasis: type === "trailing_stop" ? trailBasis : null,
        // A percent trail is a fraction on the wire; the field is in percent
        // because nobody types 0.05 to mean five.
        trailValue:
          type === "trailing_stop"
            ? trailBasis === "percent"
              ? Number(trailValue) / 100
              : Number(trailValue)
            : null,
        timeInForce,
        expiresAt:
          timeInForce === "gtd" && expiresAt
            ? new Date(expiresAt).toISOString()
            : null,
        reduceOnly,
        fees: Number(fees) || 0,
        ...(note ? { note } : {}),
        bracket:
          // The bracket fields hide under reduce-only, but their state does
          // not reset; without this a hidden bracket still went out.
          bracket && !reduceOnly && (takeProfit || stopLoss)
            ? {
                takeProfitPrice: takeProfit ? Number(takeProfit) : null,
                stopLossPrice: stopLoss ? Number(stopLoss) : null,
                stopLossTrailBasis: null,
                stopLossTrailValue: null,
              }
            : null,
      });
      setQuantity("");
      setValue("");
      setNote("");
      onDone?.();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Order rejected");
    } finally {
      setBusy(false);
    }
  }, [
    ticker,
    shares,
    type,
    limitPrice,
    stopPrice,
    trailBasis,
    trailValue,
    timeInForce,
    expiresAt,
    reduceOnly,
    fees,
    note,
    bracket,
    takeProfit,
    stopLoss,
    side,
    onSubmit,
    onDone,
  ]);

  const needsLimit = type === "limit" || type === "stop_limit";
  const needsStop = type === "stop" || type === "stop_limit";

  const holding =
    held && held.quantity !== 0
      ? `${held.quantity < 0 ? "short " : ""}${trimQuantity(
          Math.abs(held.quantity),
        )} @ ${held.avgCost.toFixed(2)}`
      : null;

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={side}
        onValueChange={(next) => setSide(next === "sell" ? "sell" : "buy")}
      >
        <TabsList variant="line">
          <TabsTrigger value="buy">
            {held && held.quantity < 0 ? "Buy / cover" : "Buy"}
          </TabsTrigger>
          <TabsTrigger value="sell">
            {held && held.quantity > 0 ? "Sell" : "Sell short"}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {fixedTicker ? (
        <TickerLine ticker={fixedTicker} holding={holding} />
      ) : (
        <FormField label="Symbol">
          <SymbolSearch onSelect={pickTicker} className="w-full" />
          {ticker ? <TickerLine ticker={ticker} holding={holding} /> : null}
        </FormField>
      )}

      <FormGrid>
        <FormField label="Type">
          <Select
            value={type}
            onValueChange={(next) => setType(next as OrderType)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_LABELS) as OrderType[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {TYPE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Time in force">
          <Select
            value={timeInForce}
            onValueChange={(next) => setTimeInForce(next as TimeInForce)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TIF_LABELS) as TimeInForce[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {TIF_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <SizeField
          id="order-size"
          shares={sizing === "shares"}
          baseCurrency={baseCurrency}
          value={sizing === "shares" ? quantity : value}
          onValueChange={sizing === "shares" ? setQuantity : setValue}
          onToggleUnit={() =>
            setSizing(sizing === "shares" ? "value" : "shares")
          }
        />
        <FormField label="Last" htmlFor="order-last">
          <Input
            id="order-last"
            value={last === null ? "" : last.toFixed(2)}
            readOnly
            tabIndex={-1}
            className="text-muted-foreground tabular-nums"
          />
        </FormField>
        <div className="sm:col-span-2">
          <FractionBar onPick={applyFraction} />
        </div>

        {needsStop ? (
          <FormField label="Stop" htmlFor="order-stop">
            <Input
              id="order-stop"
              value={stopPrice}
              onChange={(event) => setStopPrice(event.target.value)}
              inputMode="decimal"
              className="tabular-nums"
            />
          </FormField>
        ) : null}
        {needsLimit ? (
          <FormField label="Limit" htmlFor="order-limit">
            <Input
              id="order-limit"
              value={limitPrice}
              onChange={(event) => setLimitPrice(event.target.value)}
              inputMode="decimal"
              className="tabular-nums"
            />
          </FormField>
        ) : null}

        {type === "trailing_stop" ? (
          <>
            <FormField label="Trail" htmlFor="order-trail">
              <Input
                id="order-trail"
                value={trailValue}
                onChange={(event) => setTrailValue(event.target.value)}
                inputMode="decimal"
                className="tabular-nums"
              />
            </FormField>
            <FormField label="Basis">
              <Select
                value={trailBasis}
                onValueChange={(next) =>
                  setTrailBasis(next === "amount" ? "amount" : "percent")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent</SelectItem>
                  <SelectItem value="amount">{baseCurrency}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </>
        ) : null}

        {timeInForce === "gtd" ? (
          <FormField
            label="Expires"
            htmlFor="order-expires"
            className="sm:col-span-2"
          >
            <Input
              id="order-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="tabular-nums"
            />
          </FormField>
        ) : null}

        <FormField label="Fees" htmlFor="order-fees">
          <Input
            id="order-fees"
            value={fees}
            onChange={(event) => setFees(event.target.value)}
            inputMode="decimal"
            className="tabular-nums"
          />
        </FormField>
        <div className="flex items-end gap-x-5 gap-y-2 pb-1.5">
          <SwitchLabel
            id="order-reduce-only"
            label="Reduce only"
            checked={reduceOnly}
            onCheckedChange={setReduceOnly}
          />
          {reduceOnly ? null : (
            <SwitchLabel
              id="order-bracket"
              label="Bracket"
              checked={bracket}
              onCheckedChange={setBracket}
            />
          )}
        </div>

        {!reduceOnly && bracket ? (
          <>
            <FormField label="Take profit" htmlFor="order-take-profit">
              <Input
                id="order-take-profit"
                value={takeProfit}
                onChange={(event) => setTakeProfit(event.target.value)}
                inputMode="decimal"
                className="tabular-nums"
              />
            </FormField>
            <FormField label="Stop loss" htmlFor="order-stop-loss">
              <Input
                id="order-stop-loss"
                value={stopLoss}
                onChange={(event) => setStopLoss(event.target.value)}
                inputMode="decimal"
                className="tabular-nums"
              />
            </FormField>
          </>
        ) : null}

        <FormField label="Note" htmlFor="order-note" className="sm:col-span-2">
          <Input
            id="order-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
      </FormGrid>

      <Preview>
        <PreviewRow
          label={sizing === "shares" ? "Notional" : "Shares"}
          value={
            sizing === "shares"
              ? money(notional)
              : working > 0
                ? trimQuantity(shares)
                : "—"
          }
        />
        {closing > 0 ? (
          <PreviewRow
            label="Closes"
            value={trimQuantity(Number(closing.toFixed(4)))}
          />
        ) : null}
        {opening > 0 ? (
          <PreviewRow
            label={willShort ? "Opens short" : "Opens"}
            value={trimQuantity(Number(opening.toFixed(4)))}
          />
        ) : null}
        <PreviewRow
          label="Buying power"
          value={money(margin.buyingPower)}
          tone={overBuyingPower ? -1 : undefined}
        />
      </Preview>

      <TicketNotices
        problem={problem}
        warnings={[
          willShort && !allowShorts && "Shorting is off for this portfolio",
          overBuyingPower &&
            `Needs ${money(requirement)} against ${money(margin.buyingPower)}`,
        ]}
      />

      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? <Spinner className="size-3.5" /> : null}
        {TYPE_LABELS[type]} {side === "buy" ? "buy" : "sell"}
      </Button>
    </div>
  );
}

function SwitchLabel({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      {label}
    </label>
  );
}
