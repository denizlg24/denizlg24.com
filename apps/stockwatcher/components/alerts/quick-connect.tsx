"use client";

import {
  ArrowRight,
  Check,
  Clock,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api, Failure } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChannelsResponse } from "@/lib/notify/types";
import { useChannels } from "./use-channels";

export type QuickKind = keyof ChannelsResponse["connect"];

export const isQuickKind = (kind: string): kind is QuickKind =>
  kind === "telegram" || kind === "discord" || kind === "slack";

const pollMs = 3000;
const waitMs = 5 * 60_000;

const copy: Record<
  QuickKind,
  {
    name: string;
    title: string;
    lead: string;
    steps: ReactNode;
    need: ReactNode;
    action: string;
    manual: string;
  }
> = {
  telegram: {
    name: "Telegram",
    title: "Connect Telegram",
    lead: "Alerts arrive as messages from the Stockwatcher bot in your Telegram. There is nothing to copy or paste.",
    steps: (
      <>
        <li>
          Press <b>Open Telegram</b>. Telegram opens a chat with the
          Stockwatcher bot, in the app or in a new tab.
        </li>
        <li>
          Press <b>Start</b> at the bottom of that chat.
        </li>
        <li>Come back to this page. It notices the connection by itself.</li>
      </>
    ),
    need: "Telegram on this computer or your phone.",
    action: "Open Telegram",
    manual: "Prefer to use a bot of your own?",
  },
  discord: {
    name: "Discord",
    title: "Connect Discord",
    lead: "Discord asks which server and channel the alerts should go to. Stockwatcher can only post messages in that one channel.",
    steps: (
      <>
        <li>
          Press <b>Connect Discord</b>. Sign in to Discord if it asks.
        </li>
        <li>
          Pick the server and the channel, then press <b>Authorize</b>.
        </li>
        <li>Discord sends you back here with the channel connected.</li>
      </>
    ),
    need: "permission to manage webhooks in that Discord server.",
    action: "Connect Discord",
    manual: "Prefer to paste a webhook link yourself?",
  },
  slack: {
    name: "Slack",
    title: "Connect Slack",
    lead: "Slack asks which channel the alerts should go to. Stockwatcher can only post messages in that one channel.",
    steps: (
      <>
        <li>
          Press <b>Connect Slack</b>. Sign in to Slack if it asks.
        </li>
        <li>
          Pick the channel, then press <b>Allow</b>.
        </li>
        <li>Slack sends you back here with the channel connected.</li>
      </>
    ),
    need: "a Slack workspace where you’re allowed to add apps.",
    action: "Connect Slack",
    manual: "Prefer to paste a webhook link yourself?",
  },
};

type Phase =
  | { at: "idle" }
  | { at: "starting" }
  | { at: "leaving" }
  | { at: "waiting"; url: string; blocked: boolean; known: Set<string> }
  | { at: "late"; url: string; known: Set<string> };

export function QuickConnect({
  kind,
  preview,
  close,
  manual,
}: {
  kind: QuickKind;
  preview: ReactNode;
  close: () => void;
  manual: () => void;
}) {
  const text = copy[kind];
  const { data, mutate, isLoading } = useChannels();
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [error, setError] = useState<Error>();

  const watching = phase.at === "waiting" || phase.at === "late";
  const joined = watching
    ? data.channels.find(
        (item) => item.kind === kind && !phase.known.has(item.id),
      )
    : undefined;
  const polling = phase.at === "waiting" && !joined;

  useEffect(() => {
    if (!watching || joined) return;
    const refresh = () => void mutate();
    window.addEventListener("focus", refresh);
    const timer = polling ? setInterval(refresh, pollMs) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [watching, joined, polling, mutate]);

  useEffect(() => {
    if (phase.at !== "waiting" || joined) return;
    const timer = setTimeout(
      () => setPhase({ at: "late", url: phase.url, known: phase.known }),
      waitMs,
    );
    return () => clearTimeout(timer);
  }, [phase, joined]);

  const start = async () => {
    setError(undefined);
    // Opened before the request so popup blockers see the click.
    const tab = kind === "telegram" ? window.open("", "_blank") : null;
    const known = new Set(data.channels.map((item) => item.id));
    setPhase({ at: "starting" });
    try {
      const { url } = await api<{ url: string }>(
        `/api/alerts/connect/${kind}`,
        { method: "POST" },
      );
      if (kind !== "telegram") {
        setPhase({ at: "leaving" });
        window.location.assign(url);
        return;
      }
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
      setPhase({ at: "waiting", url, blocked: !tab, known });
    } catch (cause) {
      tab?.close();
      setPhase({ at: "idle" });
      setError(
        cause instanceof Error
          ? cause
          : new Error(`${text.name} couldn’t be reached. Try again.`),
      );
    }
  };

  const busy = phase.at === "starting" || phase.at === "leaving" || isLoading;

  if (joined)
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
        <DialogContent className="ibkr-guide cg-done">
          <div className="guide-main">
            <p className="guide-count">Connected</p>
            <DialogTitle className="guide-title">
              {text.name} is connected
            </DialogTitle>
            <DialogDescription asChild>
              <div className="guide-body">
                <p>
                  Stockwatcher sent a confirmation to your Telegram chat. When
                  you create or edit an alert, tick <b>{joined.label}</b> under
                  Notify to get it there.
                </p>
              </div>
            </DialogDescription>
            <p className="cg-quick-done" role="status">
              <Check size={16} /> {joined.label} · {joined.target}
            </p>
            <div className="guide-footer cg-footer-end">
              <Button type="button" size="lg" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && phase.at !== "leaving") close();
      }}
    >
      <DialogContent className="ibkr-guide cg-done">
        <div className="guide-main">
          <p className="guide-count">One-click setup</p>
          <DialogTitle className="guide-title">{text.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="guide-body">
              <p>{text.lead}</p>
            </div>
          </DialogDescription>
          <ol className="cg-quick-steps">{text.steps}</ol>
          <div className="cg-quick-action">
            {watching ? (
              <Button
                asChild
                size="lg"
                variant={
                  phase.at === "late" ||
                  (phase.at === "waiting" && phase.blocked)
                    ? "default"
                    : "outline"
                }
              >
                <a href={phase.url} target="_blank" rel="noreferrer">
                  {phase.at === "waiting" && phase.blocked
                    ? "Open Telegram"
                    : "Open Telegram again"}{" "}
                  <ExternalLink />
                </a>
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                disabled={busy}
                onClick={() => void start()}
              >
                {busy && !isLoading ? (
                  <>
                    <LoaderCircle className="motion-safe:animate-spin" />{" "}
                    Opening {text.name}…
                  </>
                ) : (
                  <>
                    {text.action} <ArrowRight />
                  </>
                )}
              </Button>
            )}
            <span className="cg-quick-status" aria-live="polite">
              {phase.at === "waiting" ? (
                <>
                  <LoaderCircle
                    size={15}
                    className="motion-safe:animate-spin"
                  />{" "}
                  {phase.blocked
                    ? "Your browser blocked the new tab. Press Open Telegram."
                    : "Waiting for you to press Start in Telegram…"}
                </>
              ) : phase.at === "late" ? (
                <>
                  Telegram hasn’t confirmed yet. If you pressed Start, this
                  updates when you come back to this page.
                </>
              ) : null}
            </span>
          </div>
          {phase.at === "late" ? (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => void start()}
            >
              Start over with a new link
            </Button>
          ) : null}
          <Failure error={error} />
          <ul className="guide-points">
            <li>
              <Check size={16} />
              <span>
                <b>You’ll need</b> {text.need}
              </span>
            </li>
            <li>
              <Clock size={16} />
              <span>
                <b>Under a minute.</b> You only do this once.
              </span>
            </li>
            <li>
              <ShieldCheck size={16} />
              <span>
                <b>Private.</b> Stockwatcher only sends alert messages, and you
                can remove the channel here at any time.
              </span>
            </li>
          </ul>
          {preview}
          <div className="guide-footer cg-quick-manual">
            <span className="guide-help">{text.manual}</span>
            <Button
              type="button"
              variant="outline"
              disabled={phase.at === "leaving"}
              onClick={manual}
            >
              Set it up by hand <ArrowRight />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
