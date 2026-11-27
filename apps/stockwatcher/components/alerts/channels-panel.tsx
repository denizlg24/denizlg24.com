"use client";

import {
  Check,
  CircleAlert,
  Monitor,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type ChannelKind, channelKinds } from "@/lib/models";
import type { Channel } from "@/lib/notify/types";
import { RemoveDialog } from "../forms";
import { api } from "../shared";
import { useBrowserAlerts } from "./browser-alerts";
import { channelMeta } from "./channel-guide";
import { ago } from "./format";
import { isQuickKind } from "./quick-connect";
import { useChannels } from "./use-channels";
import { type PushSupport, usePushSupport } from "./web-push";

export type Usage = { alerts: number; signals: number; routines: number };

const pushHint: Record<PushSupport, string | null> = {
  pending: null,
  ready: null,
  denied: "Blocked in browser settings",
  "home-screen": "Add to Home Screen first",
  unsupported: "Not supported in this browser",
};

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function ChannelRow({
  channel,
  usage,
  notify,
  changed,
}: {
  channel: Channel;
  usage: Usage;
  notify: (message: string, error?: boolean) => void;
  changed: () => void;
}) {
  const [busy, setBusy] = useState<"test" | null>(null);
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
  const used = usage.alerts + usage.signals + usage.routines;
  return (
    <li className="channel-row" data-status={channel.status}>
      <span className="channel-glyph" data-kind={channel.kind}>
        <Icon size={16} aria-hidden />
      </span>
      <div className="channel-who">
        <strong>{channel.label}</strong>
        <span className="muted">
          {meta.name} · {channel.target}
        </span>
      </div>
      <div className="channel-health">
        {channel.status === "error" ? (
          <span className="negative">
            <CircleAlert size={12} aria-hidden />{" "}
            {channel.error ?? "Last delivery failed"}
          </span>
        ) : (
          <span>
            <Check size={12} aria-hidden className="positive" />{" "}
            {channel.sentAt
              ? `Delivered ${ago(channel.sentAt)}`
              : "Nothing sent yet"}
          </span>
        )}
        <span className="muted">
          {used
            ? [
                usage.alerts ? plural(usage.alerts, "alert") : null,
                usage.signals ? plural(usage.signals, "signal") : null,
                usage.routines ? plural(usage.routines, "routine") : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Not on any alert yet"}
        </span>
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

export function ChannelsPanel({
  demo,
  usage,
  notify,
  setup,
  reload,
}: {
  demo: boolean;
  usage: Map<string, Usage>;
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
            Every alert shows up in the app. Connect a channel to also get it on
            your phone or in your inbox, then tick it under Notify on each
            alert.
          </p>
        </div>
      </div>
      {data.channels.length ? (
        <ul className="channel-rows" aria-label="Connected channels">
          {data.channels.map((item) => (
            <ChannelRow
              key={item.id}
              channel={item}
              usage={
                usage.get(item.id) ?? { alerts: 0, signals: 0, routines: 0 }
              }
              notify={notify}
              changed={changed}
            />
          ))}
        </ul>
      ) : null}
      <h3 className="channel-add-title">
        {data.channels.length ? "Add another channel" : "Connect a channel"}
      </h3>
      <ul className="channel-options">
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
                className="channel-option"
                disabled={unavailable}
                onClick={() => setup(kind)}
              >
                <span className="channel-glyph" data-kind={kind}>
                  <Icon size={16} aria-hidden />
                </span>
                <span className="channel-option-text">
                  <strong>
                    {meta.name}
                    {connected.has(kind) ? (
                      <em className="channel-connected">
                        <Check size={11} aria-hidden /> Connected
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
                <Plus className="channel-option-plus" size={14} aria-hidden />
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="channel-option"
            disabled={
              browser.state === "unsupported" || browser.state === "denied"
            }
            aria-pressed={browser.state === "on"}
            onClick={() => void browser.toggle()}
          >
            <span className="channel-glyph" data-kind="browser">
              <Monitor size={16} aria-hidden />
            </span>
            <span className="channel-option-text">
              <strong>
                This tab
                {browser.state === "on" ? (
                  <em className="channel-connected">
                    <Check size={11} aria-hidden /> On
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
              <X className="channel-option-plus" size={14} aria-hidden />
            ) : (
              <Plus className="channel-option-plus" size={14} aria-hidden />
            )}
          </button>
        </li>
      </ul>
    </section>
  );
}
