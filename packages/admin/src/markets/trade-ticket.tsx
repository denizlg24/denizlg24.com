"use client";

import { CASH_TICKER } from "@repo/markets/core";
import type { Position, Quote } from "@repo/markets/schemas";
import { Button } from "@repo/ui/button";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Spinner } from "@repo/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "../provider";
import { localNow, money, trimQuantity } from "./format";
import { SymbolSearch } from "./symbol-search";
import {
  FractionBar,
  Preview,
  PreviewRow,
  SizeField,
  TickerLine,
  TicketNotices,
} from "./ticket-fields";

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

  // `initialPrice` is the streaming quote, so it changes on every tick. Once
  // the owner has typed a price — a historical fill, say — the live value must
  // stop overwriting it.
  const priceEdited = useRef(false);
  useEffect(() => {
    if (initialPrice != null && !priceEdited.current) {
      setPrice(initialPrice.toFixed(2));
    }
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
          if (last != null) {
            priceEdited.current = false;
            setPrice(last.toFixed(2));
          }
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
    // Rounded here so what is submitted is the size the preview shows, not
    // the unrounded float behind it.
    return hasFill ? Number((amount / fill).toFixed(4)) : 0;
  }, [isCashMove, sizing, quantity, value, hasFill, fill]);

  const gross = isCashMove ? Number(quantity) || 0 : shares * fill;
  // The fees input is hidden for a cash movement, so a fee typed on a trade
  // would otherwise still be subtracted from the deposit and posted with it.
  const charge = isCashMove ? 0 : Number(fees) || 0;
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
      if (kind === "sell" && held && held.quantity > 0) {
        setSizing("shares");
        setQuantity(trimQuantity(held.quantity * fraction));
        return;
      }
      if (kind === "buy" && cash !== undefined) {
        setSizing("value");
        setValue((cash * fraction).toFixed(2));
        return;
      }
      if (kind === "withdrawal" && cash !== undefined) {
        setQuantity((cash * fraction).toFixed(2));
      }
    },
    [kind, held, cash],
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
    cashAfter !== null &&
    cashAfter < 0 &&
    (kind === "buy" || kind === "withdrawal");
  const oversold =
    kind === "sell" && held !== null && shares > held.quantity + 1e-9;
  const unheld = kind === "sell" && ticker !== "" && held === null;

  const holding = held
    ? `${trimQuantity(held.quantity)} @ ${held.avgCost.toFixed(2)}`
    : null;
  const showFractions =
    (kind === "sell" && held !== null && held.quantity > 0) ||
    ((kind === "buy" || kind === "withdrawal") && cash !== undefined);

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={kind} onValueChange={(next) => setKind(next as TradeKind)}>
        <TabsList variant="line">
          <TabsTrigger value="buy">Buy</TabsTrigger>
          <TabsTrigger value="sell">Sell</TabsTrigger>
          {allowCashMovements ? (
            <>
              <TabsTrigger value="deposit">Deposit</TabsTrigger>
              <TabsTrigger value="withdrawal">Withdraw</TabsTrigger>
            </>
          ) : null}
        </TabsList>
      </Tabs>

      {isCashMove ? null : fixedTicker ? (
        <TickerLine ticker={fixedTicker} holding={holding} />
      ) : (
        <FormField label="Symbol">
          <SymbolSearch onSelect={pickTicker} className="w-full" />
          {ticker ? <TickerLine ticker={ticker} holding={holding} /> : null}
        </FormField>
      )}

      <FormGrid>
        {isCashMove ? (
          <FormField
            label={`Amount (${baseCurrency})`}
            htmlFor="trade-amount"
            className="sm:col-span-2"
          >
            <Input
              id="trade-amount"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="decimal"
              className="tabular-nums"
            />
          </FormField>
        ) : (
          <>
            <SizeField
              id="trade-size"
              shares={sizing === "shares"}
              baseCurrency={baseCurrency}
              value={sizing === "shares" ? quantity : value}
              onValueChange={sizing === "shares" ? setQuantity : setValue}
              onToggleUnit={() =>
                setSizing(sizing === "shares" ? "value" : "shares")
              }
            />
            <FormField label="Price" htmlFor="trade-price">
              <Input
                id="trade-price"
                value={price}
                onChange={(event) => {
                  priceEdited.current = true;
                  setPrice(event.target.value);
                }}
                inputMode="decimal"
                className="tabular-nums"
              />
            </FormField>
          </>
        )}

        {showFractions ? (
          <div className="sm:col-span-2">
            <FractionBar onPick={applyFraction} />
          </div>
        ) : null}

        {isCashMove ? null : (
          <FormField label="Fees" htmlFor="trade-fees">
            <Input
              id="trade-fees"
              value={fees}
              onChange={(event) => setFees(event.target.value)}
              inputMode="decimal"
              className="tabular-nums"
            />
          </FormField>
        )}
        <FormField
          label="Executed"
          htmlFor="trade-executed"
          className={isCashMove ? "sm:col-span-2" : undefined}
        >
          <Input
            id="trade-executed"
            type="datetime-local"
            value={executedAt}
            onChange={(event) => setExecutedAt(event.target.value)}
            className="tabular-nums"
          />
        </FormField>

        <FormField label="Note" htmlFor="trade-note" className="sm:col-span-2">
          <Input
            id="trade-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
      </FormGrid>

      <Preview>
        {isCashMove ? null : (
          <PreviewRow
            label={sizing === "shares" ? "Value" : "Shares"}
            value={
              sizing === "shares"
                ? money(gross)
                : hasFill
                  ? trimQuantity(shares)
                  : "—"
            }
          />
        )}
        <PreviewRow
          label={kind === "buy" || kind === "withdrawal" ? "Debit" : "Credit"}
          value={money(net)}
        />
        {cashAfter !== null ? (
          <PreviewRow
            label="Cash after"
            value={money(cashAfter)}
            tone={overdrawn ? -1 : undefined}
          />
        ) : null}
        {realizedPreview !== null ? (
          <PreviewRow
            label="Realised"
            value={`${realizedPreview >= 0 ? "+" : ""}${money(realizedPreview)}`}
            tone={realizedPreview}
          />
        ) : null}
      </Preview>

      <TicketNotices
        problem={problem}
        warnings={[
          oversold && `Exceeds ${trimQuantity(held?.quantity ?? 0)} held`,
          unheld && `No position in ${ticker}`,
          !oversold && !unheld && overdrawn && "Overdraws cash",
        ]}
      />

      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? <Spinner className="size-3.5" /> : null}
        {submitLabel}
      </Button>
    </div>
  );
}
