"use client";

import {
  Bell,
  BellOff,
  BellRing,
  Check,
  CircleAlert,
  Monitor,
  Pencil,
  Plus,
  Repeat,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  describeRule,
  expired,
  formatTarget,
  gap,
  reading,
} from "@/lib/alerts";
import {
  type AlertEvent,
  type AlertRule,
  type ChannelKind,
  channelKinds,
  type Signal,
} from "@/lib/models";
import type { Channel } from "@/lib/notify/types";
import { amount, cn, marketTime, percent } from "@/lib/utils";
import { type AlertDraft, AlertEditor } from "./alerts/alert-editor";
import { useBrowserAlerts } from "./alerts/browser-alerts";
import { ChannelGuide, channelMeta } from "./alerts/channel-guide";
import { isQuickKind } from "./alerts/quick-connect";
import { SignalsPanel } from "./alerts/signals-panel";
import { useChannels } from "./alerts/use-channels";
import { type PushSupport, usePushSupport } from "./alerts/web-push";
import { RemoveDialog, type Save } from "./forms";
import { useQuotes } from "./market-widgets";
import {
  api,
  Empty,
  PanelHeading,
  SectionFoot,
  SymbolLink,
  Tick,
} from "./shared";

type Outcome = { ok: true; channel: string } | { ok: false; reason: string };

/** Reads, then strips, the result Discord or Slack sent the browser back with. */
function useConnectOutcome() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("connect");
    if (status !== "ok" && status !== "error") return;
    setOutcome(
      status === "ok"
        ? { ok: true, channel: params.get("channel") || "The channel" }
        : { ok: false, reason: params.get("reason") || "That didn’t work." },
    );
    for (const key of ["connect", "channel", "reason"]) params.delete(key);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);
  return [outcome, () => setOutcome(null)] as const;
}

function ConnectOutcome({
  outcome,
  dismiss,
}: {
  outcome: Outcome;
  dismiss: () => void;
}) {
  return (
    <div
      className="connect-outcome"
      data-ok={outcome.ok}
      role={outcome.ok ? "status" : "alert"}
    >
      {outcome.ok ? <Check size={16} /> : <CircleAlert size={16} />}
      <span>
        {outcome.ok ? (
          <>
            <b>{outcome.channel}</b> is connected. Press <b>Test</b> on it under
            Where alerts reach you to check, then tick it under Notify on any
            alert.
          </>
        ) : (
          <>
            <b>The channel wasn’t connected.</b> {outcome.reason} You can try
            again under Where alerts reach you.
          </>
        )}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <X />
      </Button>
    </div>
  );
}

const pushHint: Record<PushSupport, string | null> = {
  pending: null,
  ready: null,
  denied: "Blocked in browser settings",
  "home-screen": "Add to Home Screen first",
  unsupported: "Not supported in this browser",
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
};

function ChannelCard({
  channel,
  notify,
  changed,
}: {
  channel: Channel;
  notify: (message: string, error?: boolean) => void;
  changed: () => void;
}) {
  const [busy, setBusy] = useState<"test" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const meta = channelMeta[channel.kind];
  const Icon = meta.icon;
  async function test() {
    setBusy("test");
    try {
      await api(`/api/alerts/channels/${channel.id}`, { method: "POST" });
      notify(`Test sent to ${channel.label}.`);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(null);
      changed();
    }
  }
  return (
    <li className="channel-card" data-status={channel.status}>
      <span className="channel-icon" data-kind={channel.kind}>
        <Icon size={18} />
      </span>
      <div className="channel-text">
        <strong>{channel.label}</strong>
        <span className="muted">{channel.target}</span>
        {channel.status === "error" ? (
          <span className="negative channel-error">
            <CircleAlert size={12} /> {channel.error ?? "Last delivery failed."}
          </span>
        ) : (
          <span className="muted channel-sent">
            <Check size={12} /> Last delivered {ago(channel.sentAt)}
          </span>
        )}
      </div>
      <div className="channel-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void test()}
        >
          <Send /> {busy === "test" ? "Sending…" : "Test"}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${channel.label}`}
          disabled={busy !== null}
          onClick={() => setConfirm(true)}
        >
          <Trash2 />
        </Button>
      </div>
      {confirm ? (
        <RemoveDialog
          item={`the ${channel.label} channel`}
          close={() => setConfirm(false)}
          remove={async () => {
            await api(`/api/alerts/channels/${channel.id}`, {
              method: "DELETE",
            });
            changed();
          }}
        />
      ) : null}
    </li>
  );
}

function Channels({
  demo,
  notify,
  setup,
  reload,
}: {
  demo: boolean;
  notify: (message: string, error?: boolean) => void;
  setup: (kind: ChannelKind) => void;
  reload: () => void;
}) {
  const { data, mutate } = useChannels();
  const browser = useBrowserAlerts();
  const push = usePushSupport();
  const connected = new Set(data.channels.map((item) => item.kind));
  const changed = () => {
    void mutate();
    reload();
  };
  return (
    <section className="panel channels-panel" aria-labelledby="channels-title">
      <div className="panel-heading">
        <div>
          <h2 id="channels-title">Where alerts reach you</h2>
          <p>
            Every alert shows up here. Connect a channel to also get it on your
            phone or inbox, then pick channels per alert.
          </p>
        </div>
      </div>
      {data.channels.length ? (
        <ul className="channel-list">
          {data.channels.map((item) => (
            <ChannelCard
              key={item.id}
              channel={item}
              notify={notify}
              changed={changed}
            />
          ))}
        </ul>
      ) : null}
      <ul className="channel-tiles" aria-label="Add a channel">
        {channelKinds.map((kind) => {
          if (kind === "push" && !data.push.publicKey) return null;
          const meta = channelMeta[kind];
          const Icon = meta.icon;
          const unavailable =
            demo ||
            (kind === "email" && !data.email.ready) ||
            (kind === "push" && push === "unsupported");
          const quick = isQuickKind(kind) && data.connect[kind];
          const hint = kind === "push" ? pushHint[push] : null;
          return (
            <li key={kind}>
              <button
                type="button"
                className="channel-tile"
                data-kind={kind}
                disabled={unavailable}
                onClick={() => setup(kind)}
              >
                <span className="channel-icon" data-kind={kind}>
                  <Icon size={20} />
                </span>
                <span className="channel-tile-text">
                  <strong>
                    {meta.name}
                    {connected.has(kind) ? (
                      <em className="channel-on">
                        <Check size={11} /> Connected
                      </em>
                    ) : null}
                  </strong>
                  <span>{meta.blurb}</span>
                  <small>
                    {demo
                      ? "Not available in preview"
                      : kind === "email" && !data.email.ready
                        ? "Email isn’t configured on this server"
                        : hint
                          ? hint
                          : connected.has(kind)
                            ? "Add another"
                            : quick
                              ? "Connect in one click"
                              : `Set up · ${meta.time}`}
                  </small>
                </span>
                <Plus className="channel-tile-plus" size={16} />
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="channel-tile"
            data-kind="browser"
            disabled={
              browser.state === "unsupported" || browser.state === "denied"
            }
            onClick={() => void browser.toggle()}
          >
            <span className="channel-icon" data-kind="browser">
              <Monitor size={20} />
            </span>
            <span className="channel-tile-text">
              <strong>
                This tab
                {browser.state === "on" ? (
                  <em className="channel-on">
                    <Check size={11} /> On
                  </em>
                ) : null}
              </strong>
              <span>
                Pop-up notifications while Stockwatcher is open in a tab.
              </span>
              <small>
                {browser.state === "denied"
                  ? "Blocked in browser settings"
                  : browser.state === "unsupported"
                    ? "Not supported here"
                    : browser.state === "on"
                      ? "Click to turn off"
                      : "Click to turn on"}
              </small>
            </span>
            {browser.state === "on" ? (
              <X className="channel-tile-plus" size={16} />
            ) : (
              <Plus className="channel-tile-plus" size={16} />
            )}
          </button>
        </li>
      </ul>
    </section>
  );
}

function Activity({
  log,
  channels,
  select,
  reload,
  notify,
}: {
  log: AlertEvent[];
  channels: Channel[];
  select: (ticker: string) => void;
  reload: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [clearing, setClearing] = useState(false);
  const names = new Map(channels.map((item) => [item.id, item.label]));
  return (
    <section className="panel alert-activity" aria-labelledby="activity-title">
      <div className="panel-heading">
        <div>
          <h2 id="activity-title">Activity</h2>
          <p>Every time an alert fired and where it was delivered.</p>
        </div>
        {log.length ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={clearing}
            onClick={() => {
              setClearing(true);
              api("/api/alerts/log", { method: "DELETE" })
                .then(reload)
                .catch((error: Error) => notify(error.message, true))
                .finally(() => setClearing(false));
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
      {log.length ? (
        <ol className="activity-list">
          {log.slice(0, 40).map((event) => (
            <li key={event.id}>
              <time dateTime={event.time}>
                {marketTime(Date.parse(event.time) / 1000)}
              </time>
              <div>
                <p className="activity-head">
                  {event.symbol ? (
                    <SymbolLink symbol={event.symbol} select={select} />
                  ) : (
                    <strong>{event.label}</strong>
                  )}
                  {event.price != null ? (
                    <span>
                      at {amount(event.price)} {event.currency}
                    </span>
                  ) : null}
                </p>
                <p className="activity-body">{event.message}</p>
                <p className="activity-deliveries">
                  <span className="delivery" data-ok="true">
                    <BellRing size={12} /> In app
                  </span>
                  {event.deliveries.map((item) => {
                    const Icon = channelMeta[item.kind].icon;
                    return (
                      <span
                        key={item.channel}
                        className="delivery"
                        data-ok={item.ok}
                        title={item.error ?? "Delivered"}
                      >
                        <Icon size={12} />{" "}
                        {names.get(item.channel) ?? item.label}
                        {item.ok ? <Check size={11} /> : <X size={11} />}
                      </span>
                    );
                  })}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="Nothing has fired yet">
          Triggered alerts and their deliveries will be listed here.
        </Empty>
      )}
    </section>
  );
}

export function Alerts({
  alerts,
  signals,
  log,
  ticker,
  save,
  reload,
  refresh,
  demo,
  monitoring,
  select,
  proposed,
  clearProposed,
  notify,
}: {
  alerts: AlertRule[];
  signals: Signal[];
  log: AlertEvent[];
  ticker: string;
  save: Save;
  reload: () => void;
  refresh: boolean;
  demo: boolean;
  monitoring: boolean;
  select: (ticker: string) => void;
  proposed: AlertDraft | null;
  clearProposed: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [editing, setEditing] = useState<{
    rule?: AlertRule;
    draft?: AlertDraft;
  } | null>(null);
  const [removing, setRemoving] = useState<AlertRule>();
  const [guide, setGuide] = useState<ChannelKind | null>(null);
  const [outcome, dismissOutcome] = useConnectOutcome();
  const { data: channelData, mutate: refreshChannels } = useChannels();
  const { data } = useQuotes(
    alerts.map((item) => item.symbol),
    refresh,
  );
  const quotes = new Map(data?.quotes.map((item) => [item.symbol, item]));
  const channels = new Map(channelData.channels.map((item) => [item.id, item]));

  const open = editing ?? (proposed ? { draft: proposed } : null);
  const closeEditor = () => {
    setEditing(null);
    clearProposed();
  };

  const toggle = (item: AlertRule) =>
    void save((workspace) => ({
      ...workspace,
      alerts: workspace.alerts.map((entry) =>
        entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry,
      ),
    })).catch((error: Error) => notify(error.message, true));

  return (
    <div className="alerts-view">
      {outcome ? (
        <ConnectOutcome outcome={outcome} dismiss={dismissOutcome} />
      ) : null}
      <section className="panel alerts-panel">
        <PanelHeading
          title="Alerts"
          subtitle={
            demo || !monitoring
              ? "Alerts can be configured here. Background checks are disabled in this session."
              : "Checked every two minutes. Right-click any chart, or use its bell tool, to set one at a price."
          }
        >
          <Button
            size="sm"
            onClick={() => setEditing({ draft: { symbol: ticker } })}
          >
            <Plus /> New alert
          </Button>
        </PanelHeading>
        {alerts.length ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead className="text-right col-mid">Now</TableHead>
                  <TableHead className="text-right">To target</TableHead>
                  <TableHead className="col-mid">Notify</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="col-wide">Last fired</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((item) => {
                  const quote = quotes.get(item.symbol);
                  const value = reading(item, quote);
                  const distance = gap(item, quote);
                  const lapsed = expired(item);
                  const status = lapsed
                    ? "Expired"
                    : item.enabled
                      ? item.primed
                        ? "Armed"
                        : "Waiting to reset"
                      : item.lastTriggered
                        ? "Triggered"
                        : "Paused";
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <SymbolLink
                          symbol={item.symbol}
                          select={select}
                          label={quote?.name}
                        />
                      </TableCell>
                      <TableCell className="alert-rule-cell">
                        <span className="strong-cell">
                          {describeRule(item)}
                        </span>
                        <span className="alert-rule-meta muted">
                          {item.repeat === "rearm" ? (
                            <span title="Re-arms after the condition clears">
                              <Repeat size={11} /> every crossing
                            </span>
                          ) : null}
                          {item.expires ? (
                            <span>until {item.expires}</span>
                          ) : null}
                          {item.note ? (
                            <span className="alert-note" title={item.note}>
                              {item.note}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right col-mid">
                        {item.metric === "price" ? (
                          <Tick value={quote?.price} />
                        ) : value != null ? (
                          formatTarget(item.metric, value)
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right muted">
                        {distance == null
                          ? "—"
                          : item.metric === "price" || item.metric === "volume"
                            ? percent(distance)
                            : `${distance > 0 ? "+" : ""}${distance.toFixed(2)} pts`}
                      </TableCell>
                      <TableCell className="col-mid">
                        <span className="alert-route">
                          <BellRing size={13} aria-label="In app" />
                          {item.channels.map((id) => {
                            const channel = channels.get(id);
                            if (!channel) return null;
                            const Icon = channelMeta[channel.kind].icon;
                            return (
                              <Icon
                                key={id}
                                size={13}
                                aria-label={channel.label}
                                className={cn(
                                  channel.status === "error" && "negative",
                                )}
                              />
                            );
                          })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="status"
                          data-status={status.toLowerCase().split(" ")[0]}
                        >
                          {status}
                        </span>
                      </TableCell>
                      <TableCell className="muted col-wide">
                        {item.lastTriggered
                          ? `${marketTime(Date.parse(item.lastTriggered) / 1000)} · ${amount(item.triggeredPrice)}${item.triggerCount > 1 ? ` · ${item.triggerCount}×` : ""}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="row-actions row-actions-end">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={
                              item.enabled ? "Pause alert" : "Arm alert"
                            }
                            onClick={() => toggle(item)}
                          >
                            {item.enabled ? <BellOff /> : <Bell />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Edit alert"
                            onClick={() => setEditing({ rule: item })}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Delete alert"
                            onClick={() => setRemoving(item)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <SectionFoot>
              <span>
                {data?.source ?? "Market data"} · price targets in each
                listing’s quote currency
              </span>
              <span>
                {alerts.filter((item) => item.enabled).length} of{" "}
                {alerts.length} armed
              </span>
            </SectionFoot>
          </>
        ) : (
          <Empty title="No alerts yet">
            Set a price, daily move or volume level. Right-click a chart to set
            one at the price under your cursor.
          </Empty>
        )}
      </section>
      <SignalsPanel
        signals={signals}
        channels={channelData.channels}
        save={save}
        notify={notify}
        monitoring={monitoring && !demo}
      />
      <Channels demo={demo} notify={notify} setup={setGuide} reload={reload} />
      <Activity
        log={log}
        channels={channelData.channels}
        select={select}
        reload={reload}
        notify={notify}
      />
      {open ? (
        <AlertEditor
          key={open.rule?.id ?? JSON.stringify(open.draft)}
          rule={open.rule}
          draft={open.draft}
          channels={channelData.channels}
          save={save}
          close={closeEditor}
          saved={(rule) =>
            notify(
              `${open.rule ? "Saved" : "Alert set"}: ${rule.symbol} ${describeRule(rule).toLowerCase()}.`,
            )
          }
          setupChannel={demo ? undefined : () => setGuide("email")}
        />
      ) : null}
      {guide ? (
        <ChannelGuide
          kind={guide}
          close={() => setGuide(null)}
          created={(channel) => {
            void refreshChannels();
            notify(`${channel.label} connected. A test message is on its way.`);
          }}
          emailReady={channelData.email.ready}
          defaultEmail={channelData.email.address}
          connect={channelData.connect}
          pushKey={channelData.push.publicKey}
        />
      ) : null}
      {removing ? (
        <RemoveDialog
          item={`the ${removing.symbol} alert`}
          close={() => setRemoving(undefined)}
          remove={() =>
            save((workspace) => ({
              ...workspace,
              alerts: workspace.alerts.filter(
                (item) => item.id !== removing.id,
              ),
            }))
          }
        />
      ) : null}
    </div>
  );
}
