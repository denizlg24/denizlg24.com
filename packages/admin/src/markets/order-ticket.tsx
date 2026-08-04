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
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "../provider";
import { money, toneClass, trimQuantity } from "./format";
import { SymbolSearch } from "./symbol-search";

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

  const priceEdited = useRef(false);
  useEffect(() => {
    if (initialPrice != null) setLast(initialPrice);
  }, [initialPrice]);

  const pickTicker = useCallback(
    (next: string) => {
      const upper = next.toUpperCase();
      setTicker(upper);
      priceEdited.current = false;
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
    return working > 0 ? amount / working : 0;
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
          bracket && (takeProfit || stopLoss)
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

  return (
    <div className="space-y-3 text-xs">
      <Tabs
        value={side}
        onValueChange={(next) => setSide(next as "buy" | "sell")}
      >
        <TabsList variant="line" className="h-7">
          <TabsTrigger value="buy" className="px-2 text-xs">
            {held && held.quantity < 0 ? "Buy / cover" : "Buy"}
          </TabsTrigger>
          <TabsTrigger value="sell" className="px-2 text-xs">
            {held && held.quantity > 0 ? "Sell" : "Sell short"}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {fixedTicker ? (
        <div className="flex items-baseline justify-between">
          <span className="font-medium text-sm tabular-nums">
            {fixedTicker}
          </span>
          <PositionChip position={held} />
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">Symbol</Label>
          <SymbolSearch onSelect={pickTicker} className="w-full" />
          {ticker ? (
            <div className="flex items-baseline justify-between pt-0.5">
              <span className="font-medium tabular-nums">{ticker}</span>
              <PositionChip position={held} />
            </div>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select
            value={type}
            onValueChange={(next) => setType(next as OrderType)}
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_LABELS) as OrderType[]).map((option) => (
                <SelectItem key={option} value={option} className="text-xs">
                  {TYPE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Time in force</Label>
          <Select
            value={timeInForce}
            onValueChange={(next) => setTimeInForce(next as TimeInForce)}
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TIF_LABELS) as TimeInForce[]).map((option) => (
                <SelectItem key={option} value={option} className="text-xs">
                  {TIF_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              {sizing === "shares" ? "Quantity" : `Value (${baseCurrency})`}
            </Label>
            <button
              type="button"
              onClick={() =>
                setSizing(sizing === "shares" ? "value" : "shares")
              }
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              {sizing === "shares" ? baseCurrency : "shares"}
            </button>
          </div>
          <Input
            value={sizing === "shares" ? quantity : value}
            onChange={(event) =>
              sizing === "shares"
                ? setQuantity(event.target.value)
                : setValue(event.target.value)
            }
            inputMode="decimal"
            className="h-8 text-xs tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Last</Label>
          <Input
            value={last === null ? "" : last.toFixed(2)}
            readOnly
            className="h-8 bg-muted/40 text-xs tabular-nums"
          />
        </div>
      </div>

      <div className="flex gap-1">
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <button
            key={fraction}
            type="button"
            onClick={() => applyFraction(fraction)}
            className="flex-1 rounded border py-0.5 text-[10px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          >
            {fraction === 1 ? "Max" : `${fraction * 100}%`}
          </button>
        ))}
      </div>

      {needsLimit || needsStop ? (
        <div className="grid grid-cols-2 gap-2">
          {needsStop ? (
            <div className="space-y-1">
              <Label className="text-xs">Stop</Label>
              <Input
                value={stopPrice}
                onChange={(event) => setStopPrice(event.target.value)}
                inputMode="decimal"
                className="h-8 text-xs tabular-nums"
              />
            </div>
          ) : null}
          {needsLimit ? (
            <div className="space-y-1">
              <Label className="text-xs">Limit</Label>
              <Input
                value={limitPrice}
                onChange={(event) => setLimitPrice(event.target.value)}
                inputMode="decimal"
                className="h-8 text-xs tabular-nums"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {type === "trailing_stop" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Trail</Label>
            <Input
              value={trailValue}
              onChange={(event) => setTrailValue(event.target.value)}
              inputMode="decimal"
              className="h-8 text-xs tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Basis</Label>
            <Select
              value={trailBasis}
              onValueChange={(next) =>
                setTrailBasis(next as "amount" | "percent")
              }
            >
              <SelectTrigger size="sm" className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent" className="text-xs">
                  Percent
                </SelectItem>
                <SelectItem value="amount" className="text-xs">
                  {baseCurrency}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {timeInForce === "gtd" ? (
        <div className="space-y-1">
          <Label className="text-xs">Expires</Label>
          <Input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="h-8 text-xs tabular-nums"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Fees</Label>
          <Input
            value={fees}
            onChange={(event) => setFees(event.target.value)}
            inputMode="decimal"
            className="h-8 text-xs tabular-nums"
          />
        </div>
        <div className="flex items-end pb-1">
          <Label htmlFor="order-reduce-only" className="text-xs">
            <Switch
              id="order-reduce-only"
              checked={reduceOnly}
              onCheckedChange={setReduceOnly}
            />
            Reduce only
          </Label>
        </div>
      </div>

      {reduceOnly ? null : (
        <div className="space-y-2 border-t pt-2">
          <Label htmlFor="order-bracket" className="text-xs">
            <Switch
              id="order-bracket"
              checked={bracket}
              onCheckedChange={setBracket}
            />
            Bracket
          </Label>
          {bracket ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Take profit</Label>
                <Input
                  value={takeProfit}
                  onChange={(event) => setTakeProfit(event.target.value)}
                  inputMode="decimal"
                  className="h-8 text-xs tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Stop loss</Label>
                <Input
                  value={stopLoss}
                  onChange={(event) => setStopLoss(event.target.value)}
                  inputMode="decimal"
                  className="h-8 text-xs tabular-nums"
                />
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="space-y-0.5 border-t pt-2 text-[11px]">
        <Row
          label={sizing === "shares" ? "Notional" : "Shares"}
          value={
            sizing === "shares"
              ? money(notional)
              : working > 0
                ? trimQuantity(Number(shares.toFixed(4)))
                : "—"
          }
        />
        {closing > 0 ? (
          <Row
            label="Closes"
            value={trimQuantity(Number(closing.toFixed(4)))}
          />
        ) : null}
        {opening > 0 ? (
          <Row
            label={willShort ? "Opens short" : "Opens"}
            value={trimQuantity(Number(opening.toFixed(4)))}
          />
        ) : null}
        <Row
          label="Buying power"
          value={money(margin.buyingPower)}
          tone={overBuyingPower ? -1 : undefined}
        />
      </div>

      {problem ? <div className="text-red-600">{problem}</div> : null}
      {!problem && willShort && !allowShorts ? (
        <div className="text-amber-600">Shorting is off for this portfolio</div>
      ) : null}
      {!problem && overBuyingPower ? (
        <div className="text-amber-600">
          Needs {money(requirement)} against {money(margin.buyingPower)}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-8 flex-1 text-xs"
          disabled={busy}
          onClick={() => void submit()}
        >
          {TYPE_LABELS[type]} {side === "buy" ? "buy" : "sell"}
        </Button>
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note"
          className="h-8 flex-1 text-xs"
        />
      </div>
    </div>
  );
}

function PositionChip({ position }: { position: Position | null }) {
  if (!position || position.quantity === 0) return null;
  return (
    <span className="text-[10px] text-muted-foreground tabular-nums">
      {position.quantity < 0 ? "short " : ""}
      {trimQuantity(Math.abs(position.quantity))} @{" "}
      {position.avgCost.toFixed(2)}
    </span>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${toneClass(tone)}`}>{value}</span>
    </div>
  );
}
