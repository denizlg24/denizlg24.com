"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Plus,
  Repeat,
  Repeat1,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Failure } from "../shared";
import { useQuotes } from "../market-widgets";
import { channelMeta } from "./channel-guide";
import type { Save } from "../forms";
import type { Channel } from "@/lib/notify/types";
import {
  alertMetrics,
  symbolSchema,
  type AlertMetric,
  type AlertRule,
} from "@/lib/models";
import {
  conditionMet,
  describeRule,
  formatTarget,
  metricHints,
  metricLabels,
  reading,
  tidyPrice,
} from "@/lib/alerts";
import { amount, cn, percent } from "@/lib/utils";

export type AlertDraft = {
  symbol: string;
  target?: number;
  direction?: AlertRule["direction"];
  metric?: AlertMetric;
  repeat?: AlertRule["repeat"];
  note?: string;
  expires?: string | null;
};

const presets: Record<AlertMetric, number[]> = {
  price: [-10, -5, -2, 2, 5, 10],
  change: [-5, -3, -2, 2, 3, 5],
  move: [-15, -10, -5, 5, 10, 15],
  volume: [],
};

const units: Record<AlertMetric, string> = {
  price: "",
  change: "%",
  move: "%",
  volume: "shares",
};

export function AlertEditor({
  rule,
  draft,
  channels,
  save,
  close,
  saved,
  setupChannel,
}: {
  rule?: AlertRule;
  draft?: AlertDraft;
  channels: Channel[];
  save: Save;
  close: () => void;
  saved?: (rule: AlertRule) => void;
  setupChannel?: () => void;
}) {
  const [symbol, setSymbol] = useState(rule?.symbol ?? draft?.symbol ?? "");
  const [lookup, setLookup] = useState(symbol);
  const [metric, setMetric] = useState<AlertMetric>(
    rule?.metric ?? draft?.metric ?? "price",
  );
  const [direction, setDirection] = useState<AlertRule["direction"]>(
    rule?.direction ?? draft?.direction ?? "above",
  );
  const [target, setTarget] = useState(
    rule ? String(rule.target) : draft?.target ? String(draft.target) : "",
  );
  const [repeat, setRepeat] = useState<AlertRule["repeat"]>(
    rule?.repeat ?? draft?.repeat ?? "once",
  );
  const [expires, setExpires] = useState(rule?.expires ?? draft?.expires ?? "");
  const [note, setNote] = useState(rule?.note ?? draft?.note ?? "");
  const [chosen, setChosen] = useState<string[] | null>(rule?.channels ?? null);
  const picked =
    chosen ??
    channels.filter((item) => item.status === "active").map((item) => item.id);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error>();

  const valid = symbolSchema.safeParse(lookup);
  const { data } = useQuotes(valid.success ? [valid.data] : [], true);
  const quote = data?.quotes.find((item) => item.symbol === valid.data);
  const reference =
    metric === "move"
      ? rule?.metric === "move" && rule.symbol === lookup
        ? rule.reference
        : (quote?.price ?? null)
      : null;
  const value = reading({ metric, reference }, quote);
  const numeric = Number(target);
  const ready = target !== "" && Number.isFinite(numeric);
  const already =
    ready && value != null && conditionMet({ direction, target: numeric }, value);

  function chooseMetric(next: AlertMetric) {
    setMetric(next);
    setTarget("");
  }

  function preset(step: number) {
    if (metric === "price" && quote) {
      setTarget(String(tidyPrice(quote.price * (1 + step / 100))));
    } else setTarget(String(step));
    setDirection(step >= 0 ? "above" : "below");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(undefined);
    try {
      const ticker = symbolSchema.parse(symbol);
      if (!ready) throw new Error("Enter a target.");
      if ((metric === "price" || metric === "volume") && !(numeric > 0))
        throw new Error("Price and volume targets must be positive.");
      if (metric === "move" && ticker !== lookup) {
        setLookup(ticker);
        throw new Error(`Loading ${ticker}’s price for the starting point. Try again in a moment.`);
      }
      if (metric === "move" && reference == null)
        throw new Error("Waiting for a quote to set the starting price.");
      const fields = {
        symbol: ticker,
        metric,
        direction,
        target: numeric,
        reference: metric === "move" ? reference : null,
        repeat,
        note: note.trim(),
        channels: picked.filter((id) => channels.some((item) => item.id === id)),
        expires: expires || null,
      };
      const fresh: AlertRule = {
        ...fields,
        id: crypto.randomUUID(),
        primed: true,
        enabled: true,
        lastTriggered: null,
        triggeredPrice: null,
        triggerCount: 0,
      };
      let result = fresh;
      await save((workspace) => {
        if (!rule)
          return {
            ...workspace,
            alerts: [fresh, ...workspace.alerts].slice(0, 60),
          };
        const current = workspace.alerts.find((item) => item.id === rule.id);
        if (!current) throw new Error("This alert was deleted elsewhere.");
        const redefined =
          current.symbol !== fields.symbol ||
          current.metric !== fields.metric ||
          current.direction !== fields.direction ||
          current.target !== fields.target ||
          current.reference !== fields.reference;
        result = {
          ...current,
          ...fields,
          // A changed condition is a new rule; a note or channel tweak must not re-arm a fired one-shot.
          enabled: redefined ? true : current.enabled,
        };
        return {
          ...workspace,
          alerts: workspace.alerts.map((item) =>
            item.id === rule.id ? result : item,
          ),
        };
      });
      saved?.(result);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Unable to save."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) close();
      }}
    >
      <DialogContent
        className="alert-editor sm:max-w-[760px]"
        showCloseButton={!working}
      >
        <DialogHeader>
          <DialogTitle>{rule ? "Edit alert" : "New alert"}</DialogTitle>
          <DialogDescription>
            Checked every two minutes while markets are open. Delivered to the
            channels you pick and recorded under Alerts.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="alert-form">
          <div className="alert-form-top">
            <label className="field alert-symbol">
              <span>Ticker</span>
              <Input
                value={symbol}
                autoFocus={!symbol}
                maxLength={20}
                required
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                onBlur={() => setLookup(symbol.trim())}
              />
            </label>
            <div className="alert-quote" aria-live="polite">
              {quote ? (
                <>
                  <strong>{quote.name || quote.symbol}</strong>
                  <span>
                    {amount(quote.price)} {quote.currency}
                    <b
                      className={cn(
                        (quote.percent ?? 0) >= 0 ? "positive" : "negative",
                      )}
                    >
                      {" "}
                      {percent(quote.percent)}
                    </b>
                  </span>
                </>
              ) : (
                <span className="muted">
                  {valid.success ? "Loading quote…" : "Enter a ticker"}
                </span>
              )}
            </div>
          </div>

          <fieldset className="alert-metrics">
            <legend>Watch</legend>
            {alertMetrics.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={metric === item}
                onClick={() => chooseMetric(item)}
              >
                <b>{metricLabels[item]}</b>
                <small>{metricHints[item]}</small>
              </button>
            ))}
          </fieldset>

          <div className="alert-condition">
            <div className="seg alert-direction-seg" role="group" aria-label="Direction">
              <button
                type="button"
                aria-pressed={direction === "above"}
                onClick={() => setDirection("above")}
              >
                <ArrowUpRight /> At or above
              </button>
              <button
                type="button"
                aria-pressed={direction === "below"}
                onClick={() => setDirection("below")}
              >
                <ArrowDownRight /> At or below
              </button>
            </div>
            <label className="alert-target">
              <Input
                aria-label="Target"
                type="number"
                step="any"
                inputMode="decimal"
                required
                placeholder={metric === "price" ? "Price" : metric === "volume" ? "Shares" : "Percent"}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
              <span className="alert-unit">
                {metric === "price" ? (quote?.currency ?? "") : units[metric]}
              </span>
            </label>
          </div>
          {presets[metric].length ? (
            <div className="alert-presets" aria-label="Quick targets">
              {presets[metric].map((step) => (
                <button key={step} type="button" onClick={() => preset(step)}>
                  {step > 0 ? "+" : ""}
                  {step}%
                </button>
              ))}
              <span className="muted">
                {metric === "price" ? "from last price" : ""}
              </span>
            </div>
          ) : null}

          <p className={cn("alert-preview", already && "alert-preview-hot")}>
            <BellRing size={15} />
            <span>
              {ready ? (
                <>
                  Fires when <b>{lookup || "—"}</b>{" "}
                  {describeRule({ metric, direction, target: numeric, reference }).toLowerCase()}
                  {value != null
                    ? `. Now ${metric === "price" ? amount(value) : formatTarget(metric, value)}`
                    : ""}
                  {already ? ". Already met, so it fires on the next check." : "."}
                </>
              ) : (
                "Pick a target to see when this alert fires."
              )}
            </span>
          </p>

          <div className="alert-options">
            <div className="field">
              <span>Repeat</span>
              <div className="seg" role="group" aria-label="Repeat">
                <button
                  type="button"
                  aria-pressed={repeat === "once"}
                  onClick={() => setRepeat("once")}
                >
                  <Repeat1 /> Once
                </button>
                <button
                  type="button"
                  aria-pressed={repeat === "rearm"}
                  onClick={() => setRepeat("rearm")}
                >
                  <Repeat /> Every crossing
                </button>
              </div>
              <small className="muted">
                {repeat === "once"
                  ? "Pauses after it fires. Re-arm it from the list."
                  : "Re-arms itself once the condition stops being true."}
              </small>
            </div>
            <label className="field">
              <span>Expires</span>
              <Input
                type="date"
                value={expires}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setExpires(event.target.value)}
              />
              <small className="muted">Optional. Stops after this day.</small>
            </label>
          </div>

          <label className="field">
            <span>Note</span>
            <Textarea
              rows={2}
              maxLength={280}
              placeholder="Why this level matters, e.g. “Trim 1/3 at prior high”"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          <fieldset className="alert-channels">
            <legend>Notify me by</legend>
            <span className="alert-channel alert-channel-fixed">
              <BellRing size={14} /> Stockwatcher (always)
            </span>
            {channels.map((item) => {
              const Icon = channelMeta[item.kind].icon;
              const on = picked.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="alert-channel"
                  aria-pressed={on}
                  title={item.target}
                  onClick={() =>
                    setChosen(
                      on
                        ? picked.filter((id) => id !== item.id)
                        : [...picked, item.id],
                    )
                  }
                >
                  <Icon size={14} /> {item.label}
                  {item.status === "error" ? (
                    <em className="negative"> · failing</em>
                  ) : null}
                </button>
              );
            })}
            {setupChannel ? (
              <button
                type="button"
                className="alert-channel alert-channel-add"
                onClick={setupChannel}
              >
                <Plus size={14} />
                {channels.length ? "Add channel" : "Get alerts on email, WhatsApp, Telegram…"}
              </button>
            ) : null}
          </fieldset>

          <Failure error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={working} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={working}>
              {working ? "Saving…" : rule ? "Save alert" : "Create alert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
