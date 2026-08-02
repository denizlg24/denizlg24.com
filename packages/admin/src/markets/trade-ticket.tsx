"use client";

import { CASH_TICKER } from "@repo/markets/core";
import type { Position, Quote } from "@repo/markets/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { localNow, money, toneClass, trimQuantity } from "./format";
import { SymbolSearch } from "./symbol-search";

export type TradeKind = "buy" | "sell" | "deposit" | "withdrawal";

/** Shares, or an amount of money converted to shares at the fill price. */
type SizingMode = "shares" | "value";

export interface TradeTicketProps {
  baseCurrency: string;
  /** Cash on hand, used to size a buy and to warn when one overdraws. */
  cash?: number;
  /** Everything held, so a sell knows the size and basis of what it is closing. */
  positions?: Position[];
  /** Locks the ticket to one symbol — the quick-trade case from a chart. */
  fixedTicker?: string;
  /** Saves a quote round-trip when the caller is already streaming one. */
  initialPrice?: number | null;
  initialKind?: TradeKind;
  /** Cash movements are meaningless on a chart, so that surface hides them. */
  allowCashMovements?: boolean;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
  onDone?: () => void;
  submitLabel?: string;
}

export function TradeTicket({
  baseCurrency,
  cash,
  positions = [],
  fixedTicker,
  initialPrice = null,
  initialKind = "buy",
  allowCashMovements = true,
  onSubmit,
  onDone,
  submitLabel = "Add",
}: TradeTicketProps) {
  const { client } = useAdmin();
  const [kind, setKind] = useState<TradeKind>(initialKind);
  const [ticker, setTicker] = useState(fixedTicker ?? "");
  const [sizing, setSizing] = useState<SizingMode>("shares");
  const [quantity, setQuantity] = useState("");
  const [value, setValue] = useState("");
  const [price, setPrice] = useState(
    initialPrice != null ? initialPrice.toFixed(2) : "",
  );
  const [fees, setFees] = useState("");
  const [executedAt, setExecutedAt] = useState(localNow);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const isCashMove = kind === "deposit" || kind === "withdrawal";
  const held = useMemo(
    () => positions.find((position) => position.ticker === ticker) ?? null,
    [positions, ticker],
  );

  useEffect(() => {
    if (initialPrice != null) setPrice(initialPrice.toFixed(2));
  }, [initialPrice]);

  // Defaults the fill to the last known price; the field stays editable so a
  // historical trade can be entered at the price it actually filled at.
  const pickTicker = useCallback(
    (next: string) => {
      const upper = next.toUpperCase();
      setTicker(upper);
      client
        .get<{ quotes: Quote[] }>(
          `/markets/quotes?tickers=${encodeURIComponent(upper)}`,
        )
        .then((data) => {
          const last = data.quotes[0]?.last;
          if (last != null) setPrice(last.toFixed(2));
        })
        .catch(() => undefined);
    },
    [client],
  );

  const fill = Number(price);
  const hasFill = Number.isFinite(fill) && fill > 0;

  // One of the two size fields is authoritative and the other is derived, so
  // whichever the owner is typing into is the one that survives a re-render.
  const shares = useMemo(() => {
    if (isCashMove) return Number(quantity) || 0;
    if (sizing === "shares") return Number(quantity) || 0;
    const amount = Number(value) || 0;
    return hasFill ? amount / fill : 0;
  }, [isCashMove, sizing, quantity, value, hasFill, fill]);

  const gross = isCashMove ? Number(quantity) || 0 : shares * fill;
  const charge = Number(fees) || 0;
  const net = kind === "buy" ? gross + charge : gross - charge;

  const cashAfter =
    cash === undefined
      ? null
      : kind === "buy" || kind === "withdrawal"
        ? cash - net
        : cash + net;

  // Average cost, matching the engine — this is a preview of what the replay
  // will record, not a second opinion on it.
  const realizedPreview =
    kind === "sell" && held && held.quantity > 0 && hasFill
      ? (fill - held.avgCost) * Math.min(shares, held.quantity) - charge
      : null;

  const applyFraction = useCallback(
    (fraction: number) => {
      if (kind === "sell" && held) {
        setSizing("shares");
        setQuantity(trimQuantity(held.quantity * fraction));
        return;
      }
      if (kind === "buy" && cash !== undefined) {
        setSizing("value");
        setValue((cash * fraction).toFixed(2));
        return;
      }
      if (isCashMove && cash !== undefined && kind === "withdrawal") {
        setQuantity((cash * fraction).toFixed(2));
      }
    },
    [kind, held, cash, isCashMove],
  );

  const reset = useCallback(() => {
    if (!fixedTicker) setTicker("");
    setQuantity("");
    setValue("");
    setFees("");
    setNote("");
    setExecutedAt(localNow());
    setProblem(null);
  }, [fixedTicker]);

  const submit = useCallback(async () => {
    const amount = isCashMove ? Number(quantity) : shares;
    if (!Number.isFinite(amount) || amount <= 0) {
      setProblem("Size must be positive");
      return;
    }
    if (!isCashMove && !ticker) {
      setProblem("Pick a symbol");
      return;
    }
    if (!isCashMove && !hasFill) {
      setProblem("Price must be a positive number");
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await onSubmit({
        ticker: isCashMove ? CASH_TICKER : ticker,
        // A cash movement carries its direction in `source`; `side` still has
        // to satisfy the schema, so it mirrors the movement.
        side: kind === "sell" || kind === "withdrawal" ? "sell" : "buy",
        quantity: amount,
        price: isCashMove ? 1 : fill,
        fees: charge,
        executedAt: new Date(executedAt).toISOString(),
        source: isCashMove ? kind : "manual",
        ...(note ? { note } : {}),
      });
      reset();
      onDone?.();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [
    isCashMove,
    quantity,
    shares,
    ticker,
    hasFill,
    fill,
    charge,
    kind,
    executedAt,
    note,
    onSubmit,
    reset,
    onDone,
  ]);

  // Surfaced as warnings rather than blocks: a backfilled trade is entered
  // against today's cash, which legitimately reads as an overdraw.
  const overdrawn =
    cashAfter !== null && cashAfter < 0 && (kind === "buy" || isCashMove);
  const oversold =
    kind === "sell" && held !== null && shares > held.quantity + 1e-9;
  const unheld = kind === "sell" && ticker !== "" && held === null;

  return (
    <div className="space-y-3 text-xs">
      <Tabs value={kind} onValueChange={(next) => setKind(next as TradeKind)}>
        <TabsList variant="line" className="h-7">
          <TabsTrigger value="buy" className="px-2 text-xs">
            Buy
          </TabsTrigger>
          <TabsTrigger value="sell" className="px-2 text-xs">
            Sell
          </TabsTrigger>
          {allowCashMovements ? (
            <>
              <TabsTrigger value="deposit" className="px-2 text-xs">
                Deposit
              </TabsTrigger>
              <TabsTrigger value="withdrawal" className="px-2 text-xs">
                Withdraw
              </TabsTrigger>
            </>
          ) : null}
        </TabsList>
      </Tabs>

      {isCashMove ? null : fixedTicker ? (
        <div className="flex items-baseline justify-between">
          <span className="font-medium text-sm tabular-nums">
            {fixedTicker}
          </span>
          {held ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {trimQuantity(held.quantity)} @ {held.avgCost.toFixed(2)}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">Symbol</Label>
          <SymbolSearch onSelect={pickTicker} className="w-full" />
          {ticker ? (
            <div className="flex items-baseline justify-between pt-0.5">
              <span className="font-medium tabular-nums">{ticker}</span>
              {held ? (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {trimQuantity(held.quantity)} @ {held.avgCost.toFixed(2)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {isCashMove ? (
        <div className="space-y-1">
          <Label className="text-xs">Amount ({baseCurrency})</Label>
          <Input
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            className="h-8 text-xs tabular-nums"
          />
        </div>
      ) : (
        <>
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
              <Label className="text-xs">Price</Label>
              <Input
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                className="h-8 text-xs tabular-nums"
              />
            </div>
          </div>

          {(kind === "sell" && held) ||
          (kind === "buy" && cash !== undefined) ? (
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
          ) : null}
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        {isCashMove ? null : (
          <div className="space-y-1">
            <Label className="text-xs">Fees</Label>
            <Input
              value={fees}
              onChange={(event) => setFees(event.target.value)}
              inputMode="decimal"
              className="h-8 text-xs tabular-nums"
            />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Executed</Label>
          <Input
            type="datetime-local"
            value={executedAt}
            onChange={(event) => setExecutedAt(event.target.value)}
            className="h-8 text-xs tabular-nums"
          />
        </div>
      </div>

      <div className="space-y-0.5 border-t pt-2 text-[11px]">
        {isCashMove ? null : (
          <Row
            label={sizing === "shares" ? "Value" : "Shares"}
            value={
              sizing === "shares"
                ? money(gross)
                : hasFill
                  ? trimQuantity(Number(shares.toFixed(4)))
                  : "—"
            }
          />
        )}
        <Row
          label={kind === "buy" || kind === "deposit" ? "Debit" : "Credit"}
          value={money(net)}
        />
        {cashAfter !== null ? (
          <Row
            label="Cash after"
            value={money(cashAfter)}
            tone={overdrawn ? -1 : undefined}
          />
        ) : null}
        {realizedPreview !== null ? (
          <Row
            label="Realised"
            value={`${realizedPreview >= 0 ? "+" : ""}${money(realizedPreview)}`}
            tone={realizedPreview}
          />
        ) : null}
      </div>

      {problem ? <div className="text-red-600">{problem}</div> : null}
      {!problem && oversold ? (
        <div className="text-amber-600">
          Exceeds {trimQuantity(held?.quantity ?? 0)} held
        </div>
      ) : null}
      {!problem && unheld ? (
        <div className="text-amber-600">No position in {ticker}</div>
      ) : null}
      {!problem && !oversold && !unheld && overdrawn ? (
        <div className="text-amber-600">Overdraws cash</div>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-8 flex-1 text-xs"
          disabled={busy}
          onClick={() => void submit()}
        >
          {submitLabel}
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
