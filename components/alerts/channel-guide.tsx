"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Clock,
  Copy,
  ExternalLink,
  Hash,
  Info,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Star,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, Failure } from "@/components/shared";
import { cn } from "@/lib/utils";
import type { ChannelKind } from "@/lib/models";
import type { Channel } from "@/lib/notify/types";

export const channelMeta: Record<
  ChannelKind,
  { name: string; blurb: string; icon: LucideIcon; time: string }
> = {
  email: {
    name: "Email",
    blurb: "Alerts in your inbox, sent from alerts@auth.denizlg24.com",
    icon: Mail,
    time: "Under a minute",
  },
  whatsapp: {
    name: "WhatsApp",
    blurb: "Messages to your phone number via the free CallMeBot service",
    icon: MessageCircle,
    time: "About 2 minutes",
  },
  telegram: {
    name: "Telegram",
    blurb: "Messages from your own private Telegram bot",
    icon: Send,
    time: "About 3 minutes",
  },
  discord: {
    name: "Discord",
    blurb: "Posts in a Discord channel you choose",
    icon: MessagesSquare,
    time: "About 2 minutes",
  },
  slack: {
    name: "Slack",
    blurb: "Posts in a Slack channel you choose",
    icon: Hash,
    time: "About 3 minutes",
  },
  ntfy: {
    name: "Phone push",
    blurb:
      "Push notifications on your phone with the free ntfy app, no account",
    icon: BellRing,
    time: "About 2 minutes",
  },
  webhook: {
    name: "Webhook",
    blurb:
      "Signed JSON to your own endpoint, for Zapier, Make, n8n or Home Assistant",
    icon: Webhook,
    time: "About 1 minute",
  },
};

const links = {
  callmebot: "https://www.callmebot.com/blog/free-api-whatsapp-messages/",
  botfather: "https://t.me/BotFather",
  slackApps: "https://api.slack.com/apps",
  ntfyIos: "https://apps.apple.com/app/ntfy/id1625396347",
  ntfyAndroid: "https://play.google.com/store/apps/details?id=io.heckel.ntfy",
};

const permissionText = "I allow callmebot to send me messages";
const sender = "alerts@auth.denizlg24.com";

const sample = {
  title: "AAPL · Price ≥ 250",
  body: "Apple Inc. is at 251.30 USD (+2.10% today). Your alert at 250.00 was reached.",
};

type FieldName =
  | "address"
  | "phone"
  | "apikey"
  | "token"
  | "chatId"
  | "url"
  | "topic"
  | "server"
  | "ntfyToken"
  | "label";

type Values = Record<FieldName, string>;

const optional: FieldName[] = ["server", "ntfyToken", "label"];

const required: Record<ChannelKind, FieldName[]> = {
  email: ["address"],
  whatsapp: ["phone", "apikey"],
  telegram: ["token", "chatId"],
  discord: ["url"],
  slack: ["url"],
  ntfy: ["topic", "server"],
  webhook: ["url"],
};

const stripPhone = (value: string) => value.replace(/[^\d+]/g, "");

const httpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const patterns = {
  address: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+\d{8,15}$/,
  apikey: /^\d{4,12}$/,
  token: /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/,
  chatId: /^-?\d{1,20}$/,
  discord:
    /^https:\/\/((ptb|canary)\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/,
  slack: /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/,
  topic: /^[A-Za-z0-9_-]{8,64}$/,
};

function valid(kind: ChannelKind, name: FieldName, raw: string): boolean {
  const value = raw.trim();
  if (!value) return optional.includes(name);
  switch (name) {
    case "address":
      return patterns.address.test(value) && value.length <= 200;
    case "phone":
      return patterns.phone.test(stripPhone(value));
    case "apikey":
      return patterns.apikey.test(value);
    case "token":
      return patterns.token.test(value);
    case "chatId":
      return patterns.chatId.test(value);
    case "url":
      if (kind === "discord") return patterns.discord.test(value);
      if (kind === "slack") return patterns.slack.test(value);
      return httpsUrl(value) && value.length <= 500;
    case "topic":
      return patterns.topic.test(value);
    case "server":
      return httpsUrl(value) && value.length <= 200;
    case "ntfyToken":
      return value.length <= 200;
    case "label":
      return value.length <= 60;
  }
}

function payload(kind: ChannelKind, values: Values) {
  const label = values.label.trim();
  const base = { kind, ...(label ? { label } : {}) };
  const v = (name: FieldName) => values[name].trim();
  switch (kind) {
    case "email":
      return { ...base, address: v("address") };
    case "whatsapp":
      return { ...base, phone: stripPhone(v("phone")), apikey: v("apikey") };
    case "telegram":
      return { ...base, token: v("token"), chatId: v("chatId") };
    case "discord":
    case "slack":
    case "webhook":
      return { ...base, url: v("url") };
    case "ntfy":
      return {
        ...base,
        topic: v("topic"),
        ...(v("server") ? { server: v("server") } : {}),
        ...(v("ntfyToken") ? { token: v("ntfyToken") } : {}),
      };
  }
}

function randomTopic() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `stockwatcher-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}

type FieldSpec = {
  label: string;
  placeholder: string;
  hint: string;
  bad: string;
  type?: "text" | "email" | "url" | "password" | "tel";
  inputMode?: "text" | "email" | "url" | "numeric" | "tel";
  clean?: (value: string) => string;
};

function fieldSpec(kind: ChannelKind, name: FieldName): FieldSpec {
  switch (name) {
    case "address":
      return {
        label: "Email address",
        placeholder: "you@example.com",
        type: "email",
        inputMode: "email",
        hint: "Alerts go to the email address on your Stockwatcher account.",
        bad: "That doesn’t look like an email address yet.",
      };
    case "phone":
      return {
        label: "Your WhatsApp number",
        placeholder: "+351 912 345 678",
        type: "tel",
        inputMode: "tel",
        hint: "Start with + and your country code. Spaces are fine.",
        bad: "Start with + and the country code, for example +351 912 345 678.",
      };
    case "apikey":
      return {
        label: "API key from CallMeBot",
        placeholder: "For example 123456",
        inputMode: "numeric",
        clean: (value) => value.replace(/\D/g, ""),
        hint: "Only the number from CallMeBot’s reply.",
        bad: "The key is a number of 4 to 12 digits.",
      };
    case "token":
      return {
        label: "Bot token",
        placeholder: "123456789:AA…",
        type: "password",
        clean: (value) => value.replace(/\s/g, ""),
        hint: "Treat it like a password. Stockwatcher stores it encrypted.",
        bad: "A token looks like 123456789:AAH… with a colon in the middle. Copy it again from BotFather.",
      };
    case "chatId":
      return {
        label: "Chat ID",
        placeholder: "For example 123456789",
        inputMode: "numeric",
        clean: (value) => value.replace(/[^\d-]/g, ""),
        hint: "Only needed if “Find my chat” didn’t work.",
        bad: "A chat ID is a number, sometimes starting with a minus sign.",
      };
    case "url":
      if (kind === "discord")
        return {
          label: "Webhook URL",
          placeholder: "https://discord.com/api/webhooks/…",
          type: "url",
          inputMode: "url",
          clean: (value) => value.trim(),
          hint: "Paste the link from Copy Webhook URL.",
          bad: "It should start with https://discord.com/api/webhooks/.",
        };
      if (kind === "slack")
        return {
          label: "Webhook URL",
          placeholder: "https://hooks.slack.com/services/…",
          type: "url",
          inputMode: "url",
          clean: (value) => value.trim(),
          hint: "Paste the link from the Copy button.",
          bad: "It should start with https://hooks.slack.com/services/.",
        };
      return {
        label: "Endpoint URL",
        placeholder: "https://example.com/hooks/stockwatcher",
        type: "url",
        inputMode: "url",
        clean: (value) => value.trim(),
        hint: "Must be a public https address.",
        bad: "Use a full https:// address.",
      };
    case "topic":
      return {
        label: "Topic",
        placeholder: "stockwatcher-…",
        clean: (value) => value.replace(/\s/g, ""),
        hint: "8 to 64 letters, numbers, dashes or underscores.",
        bad: "Use 8 to 64 letters, numbers, dashes or underscores.",
      };
    case "server":
      return {
        label: "Server",
        placeholder: "https://ntfy.sh",
        type: "url",
        inputMode: "url",
        clean: (value) => value.trim(),
        hint: "Leave empty to use ntfy.sh.",
        bad: "Use a full https:// address.",
      };
    case "ntfyToken":
      return {
        label: "Access token",
        placeholder: "tk_…",
        type: "password",
        clean: (value) => value.trim(),
        hint: "Only for protected topics on your own server.",
        bad: "That token is too long.",
      };
    case "label":
      return {
        label: "Name this channel (optional)",
        placeholder: "For example My phone",
        hint: "Shown in your list of channels.",
        bad: "Keep it under 60 characters.",
      };
  }
}

function Mark({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("shot-mark", className)} aria-hidden>
      {n}
    </span>
  );
}

function Figure({
  caption,
  children,
}: {
  caption: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="shot">
      <div className="cg-stage" aria-hidden>
        {children}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

type App = "wa" | "tg" | "dc" | "sl" | "nt" | "mail" | "hook";

function Phone({
  app,
  head,
  children,
  foot,
}: {
  app: App;
  head?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className={cn("shot-frame cg-phone", `cg-${app}`)}>
      <div className="cg-status">
        <span>9:41</span>
        <span className="cg-status-icons">
          <i />
          <i />
          <i />
        </span>
      </div>
      {head}
      <div className="cg-screen">{children}</div>
      {foot}
    </div>
  );
}

function ChatHead({
  name,
  sub,
  avatar,
}: {
  name: string;
  sub?: string;
  avatar: ReactNode;
}) {
  return (
    <div className="cg-head">
      <ChevronLeft size={15} />
      <span className="cg-avatar">{avatar}</span>
      <span className="cg-who">
        <b>{name}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
    </div>
  );
}

function Bubble({
  out,
  children,
  className,
}: {
  out?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("cg-bubble", out ? "cg-out" : "cg-in", className)}>
      {children}
      <time>9:41</time>
    </div>
  );
}

function Composer({ text, mark }: { text?: ReactNode; mark?: boolean }) {
  return (
    <div className="cg-composer">
      <span className={cn("cg-field", mark && "shot-hl shot-rel")}>
        {text ?? <span className="shot-muted">Message</span>}
        {mark ? <Mark n={1} className="shot-mark-above" /> : null}
      </span>
      <span className={cn("cg-send", mark && "shot-hl shot-rel")}>
        <Send size={12} />
        {mark ? <Mark n={2} className="shot-mark-above" /> : null}
      </span>
    </div>
  );
}

function Window({
  url,
  app,
  children,
}: {
  url: string;
  app: App;
  children: ReactNode;
}) {
  return (
    <div className={cn("shot-frame cg-window", `cg-${app}`)}>
      <div className="shot-chrome">
        <span className="shot-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="shot-url">{url}</span>
      </div>
      {children}
    </div>
  );
}

/* ── Email ───────────────────────────────────────────────── */

function EmailPreview() {
  return (
    <Figure caption="Illustration. Your email app will look different, but the message reads like this.">
      <Window url="Your inbox" app="mail">
        <div className="cg-mail">
          <div className="cg-mail-row cg-unread">
            <Star size={12} />
            <b>Stockwatcher</b>
            <span className="cg-mail-subject">
              <b>{sample.title}</b>
              <span className="shot-muted">
                {" "}
                · Apple Inc. is at 251.30 USD…
              </span>
            </span>
            <time>9:41</time>
          </div>
          <div className="cg-mail-row shot-dim">
            <Star size={12} />
            <span>Newsletter</span>
            <span className="cg-mail-subject shot-muted">
              Weekly market wrap
            </span>
            <time>Mon</time>
          </div>
          <div className="cg-mail-open">
            <span className="shot-muted">
              From <b>Stockwatcher</b> &lt;{sender}&gt;
            </span>
            <b className="cg-mail-title">{sample.title}</b>
            <span>{sample.body}</span>
            <span className="shot-btn shot-btn-primary shot-self-start">
              Open in Stockwatcher
            </span>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

function SpamShot() {
  return (
    <Figure
      caption={
        <>
          Illustration. In Outlook the folder is called <b>Junk Email</b> and
          the button <b>Not junk</b>.
        </>
      }
    >
      <Window url="Your inbox" app="mail">
        <div className="cg-mail cg-mail-split">
          <div className="cg-folders">
            <span>Inbox</span>
            <span>Starred</span>
            <span>Sent</span>
            <span className="shot-hl shot-rel">
              Spam
              <Mark n={1} className="cg-mark-in" />
            </span>
          </div>
          <div className="cg-mail-list">
            <div className="cg-mail-tools">
              <span className="shot-btn shot-hl shot-rel">
                Not spam
                <Mark n={3} className="shot-mark-right" />
              </span>
            </div>
            <div className="cg-mail-row cg-unread shot-hl shot-rel">
              <b>Stockwatcher</b>
              <span className="cg-mail-subject">
                <b>Stockwatcher test alert</b>
              </span>
              <time>9:41</time>
              <Mark n={2} className="cg-mark-in" />
            </div>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

/* ── WhatsApp ────────────────────────────────────────────── */

const waHead = <ChatHead name="CallMeBot" sub="online" avatar="C" />;

function WhatsAppPreview() {
  return (
    <Figure caption="Illustration. This is how an alert arrives in WhatsApp.">
      <Phone app="wa" head={waHead} foot={<Composer />}>
        <Bubble>
          <b>{sample.title}</b>
          <br />
          {sample.body}
          <br />
          <span className="cg-link">Open in Stockwatcher</span>
        </Bubble>
      </Phone>
    </Figure>
  );
}

function ContactShot() {
  return (
    <Figure caption="Illustration. On some phones the button is called Done or ✓ instead of Save.">
      <Phone
        app="wa"
        head={
          <div className="cg-head cg-head-split">
            <span>Cancel</span>
            <b>New contact</b>
            <span className="cg-accent-text shot-hl shot-rel">
              Save
              <Mark n={3} className="shot-mark-below" />
            </span>
          </div>
        }
      >
        <div className="cg-form">
          <span className="cg-row shot-hl shot-rel">
            <small>First name</small>
            CallMeBot
            <Mark n={1} className="cg-mark-in" />
          </span>
          <span className="cg-row shot-dim">
            <small>Last name</small>
          </span>
          <span className="cg-row shot-hl shot-rel">
            <small>Phone</small>
            <span className="shot-muted">Number from callmebot.com</span>
            <Mark n={2} className="cg-mark-in" />
          </span>
        </div>
      </Phone>
    </Figure>
  );
}

function PermissionShot() {
  return (
    <Figure caption="Illustration. Type the sentence exactly, then press the send arrow.">
      <Phone
        app="wa"
        head={waHead}
        foot={<Composer text={permissionText} mark />}
      >
        <p className="cg-system">Messages are end-to-end encrypted.</p>
      </Phone>
    </Figure>
  );
}

function KeyShot() {
  return (
    <Figure caption="Illustration. The reply usually arrives within two minutes. Your key will be a different number.">
      <Phone app="wa" head={waHead} foot={<Composer />}>
        <Bubble out>{permissionText}</Bubble>
        <Bubble>
          API Activated for your phone number. Your APIKEY is{" "}
          <span className="cg-key shot-hl shot-rel">
            123456
            <Mark n={1} className="shot-mark-right" />
          </span>
        </Bubble>
      </Phone>
    </Figure>
  );
}

/* ── Telegram ────────────────────────────────────────────── */

function TelegramPreview() {
  return (
    <Figure caption="Illustration. Alerts arrive as messages from your own bot.">
      <Phone
        app="tg"
        head={<ChatHead name="Stockwatcher alerts" sub="bot" avatar="S" />}
        foot={<Composer />}
      >
        <Bubble>
          <b>{sample.title}</b>
          <br />
          {sample.body}
          <br />
          <span className="cg-link">Open in Stockwatcher</span>
        </Bubble>
      </Phone>
    </Figure>
  );
}

function BotFatherShot() {
  return (
    <Figure caption="Illustration. BotFather is Telegram’s official bot for making bots. It has a blue verified tick.">
      <Phone
        app="tg"
        head={<ChatHead name="BotFather" sub="bot" avatar="B" />}
        foot={<Composer />}
      >
        <Bubble out className="shot-hl shot-rel">
          /newbot
          <Mark n={1} className="shot-mark-left" />
        </Bubble>
        <Bubble>Alright, a new bot. How are we going to call it?</Bubble>
        <Bubble out className="shot-hl shot-rel">
          Stockwatcher alerts
          <Mark n={2} className="shot-mark-left" />
        </Bubble>
        <Bubble>Good. Now choose a username. It must end in “bot”.</Bubble>
        <Bubble out className="shot-hl shot-rel">
          my_stockwatcher_bot
          <Mark n={3} className="shot-mark-left" />
        </Bubble>
        <Bubble>
          Done! Use this token to access the HTTP API:{" "}
          <span className="cg-key shot-hl shot-rel">
            7123456789:AAHf3k…x9Q
            <Mark n={4} className="shot-mark-below" />
          </span>
        </Bubble>
      </Phone>
    </Figure>
  );
}

function StartShot({ bot }: { bot: string | null }) {
  return (
    <Figure caption="Illustration. If you don’t see Start, just send the message “hi”.">
      <Phone
        app="tg"
        head={
          <ChatHead name={bot ? `@${bot}` : "Your bot"} sub="bot" avatar="S" />
        }
        foot={
          <div className="cg-composer">
            <span className="cg-start shot-hl shot-rel">
              START
              <Mark n={1} className="shot-mark-above" />
            </span>
          </div>
        }
      >
        <p className="cg-system">What can this bot do?</p>
      </Phone>
    </Figure>
  );
}

/* ── Discord ─────────────────────────────────────────────── */

function DiscordChannels({ gear }: { gear?: boolean }) {
  return (
    <div className="cg-channels">
      <b>My server</b>
      <span className="shot-label">Text channels</span>
      <span># general</span>
      <span className={cn("cg-channel-on", gear && "cg-channel-gear")}>
        # alerts
        {gear ? (
          <span className="cg-gear-pair">
            <Mark n={1} className="shot-mark-inline" />
            <span className="shot-icon shot-hl">
              <Settings size={11} />
            </span>
          </span>
        ) : null}
      </span>
      <span># markets</span>
    </div>
  );
}

function DiscordPreview() {
  return (
    <Figure caption="Illustration. Alerts are posted in the channel you pick.">
      <Window url="discord.com" app="dc">
        <div className="cg-app">
          <DiscordChannels />
          <div className="cg-pane">
            <span className="cg-pane-head"># alerts</span>
            <div className="cg-post">
              <span className="cg-avatar">S</span>
              <div>
                <span>
                  <b>Stockwatcher</b> <span className="cg-tag">APP</span>{" "}
                  <span className="shot-muted">Today at 9:41</span>
                </span>
                <div className="cg-embed">
                  <b>{sample.title}</b>
                  <span>{sample.body}</span>
                  <span className="cg-link">Open in Stockwatcher</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

function DiscordSettingsShot() {
  return (
    <Figure caption="Illustration. The gear appears when you point at the channel name. On a phone, press and hold the channel and tap Edit Channel.">
      <Window url="discord.com" app="dc">
        <div className="cg-app">
          <DiscordChannels gear />
          <div className="cg-pane cg-settings">
            <span className="shot-label"># alerts · Text channels</span>
            <span>Overview</span>
            <span>Permissions</span>
            <span>Invites</span>
            <span className="shot-hl shot-rel">
              Integrations
              <Mark n={2} className="cg-mark-in" />
            </span>
            <span className="cg-danger">Delete Channel</span>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

function DiscordWebhookShot() {
  return (
    <Figure caption="Illustration. Discord may call the first button Create Webhook instead of New Webhook.">
      <Window url="discord.com" app="dc">
        <div className="cg-page">
          <p className="shot-crumb">Integrations › Webhooks</p>
          <span className="shot-btn shot-btn-primary shot-hl shot-rel shot-self-start">
            New Webhook
            <Mark n={1} className="shot-mark-right" />
          </span>
          <div className="cg-hook-card">
            <span className="cg-avatar">S</span>
            <div className="cg-hook-fields">
              <span className="shot-field">
                <span className="shot-label">Name</span>
                <span className="shot-input shot-hl shot-rel">
                  Stockwatcher
                  <Mark n={2} className="shot-mark-right" />
                </span>
              </span>
              <span className="shot-field">
                <span className="shot-label">Channel</span>
                <span className="shot-select shot-hl shot-rel">
                  # alerts <ChevronDown size={11} />
                  <Mark n={3} className="shot-mark-right" />
                </span>
              </span>
              <span className="shot-actions">
                <span className="shot-btn shot-hl shot-rel">
                  Copy Webhook URL
                  <Mark n={4} className="shot-mark-right" />
                </span>
                <span className="cg-danger">Delete Webhook</span>
              </span>
            </div>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

/* ── Slack ───────────────────────────────────────────────── */

function SlackPreview() {
  return (
    <Figure caption="Illustration. Alerts are posted in the channel you pick.">
      <Window url="app.slack.com" app="sl">
        <div className="cg-app">
          <div className="cg-channels cg-slack-side">
            <b>My workspace</b>
            <span className="shot-label">Channels</span>
            <span># general</span>
            <span className="cg-channel-on"># alerts</span>
            <span># research</span>
          </div>
          <div className="cg-pane">
            <span className="cg-pane-head"># alerts</span>
            <div className="cg-post">
              <span className="cg-avatar cg-avatar-square">S</span>
              <div>
                <span>
                  <b>Stockwatcher</b> <span className="cg-tag">APP</span>{" "}
                  <span className="shot-muted">9:41 AM</span>
                </span>
                <span className="cg-post-text">
                  <b>{sample.title}</b>
                  <br />
                  {sample.body}
                </span>
                <span className="cg-link">Open in Stockwatcher</span>
              </div>
            </div>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

function SlackCreateShot() {
  return (
    <Figure caption="Illustration. Slack asks you to sign in first if you aren’t already.">
      <Window url="api.slack.com/apps" app="sl">
        <div className="cg-page">
          <div className="cg-page-head">
            <b>Your Apps</b>
            <span className="shot-btn shot-btn-primary shot-hl shot-rel">
              Create New App
              <Mark n={1} className="shot-mark-left" />
            </span>
          </div>
          <div className="cg-pair-cards">
            <div className="shot-popup">
              <b>Create an app</b>
              <span className="cg-option shot-hl shot-rel">
                <b>From scratch</b>
                <span className="shot-muted">Use our configuration UI</span>
                <Mark n={2} className="cg-mark-in" />
              </span>
              <span className="cg-option shot-dim">
                <b>From a manifest</b>
              </span>
            </div>
            <div className="shot-popup">
              <b>Name app &amp; choose workspace</b>
              <span className="shot-field">
                <span className="shot-label">App Name</span>
                <span className="shot-input">Stockwatcher</span>
              </span>
              <span className="shot-field">
                <span className="shot-label">Workspace</span>
                <span className="shot-select">
                  My workspace <ChevronDown size={11} />
                </span>
              </span>
              <span className="shot-btn shot-btn-primary shot-hl shot-rel shot-self-start">
                Create App
                <Mark n={3} className="shot-mark-right" />
              </span>
            </div>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

function SlackHooksShot() {
  return (
    <Figure caption="Illustration. Incoming Webhooks is in the left menu under Features.">
      <Window url="api.slack.com/apps" app="sl">
        <div className="cg-app cg-app-docs">
          <div className="cg-settings">
            <span className="shot-label">Settings</span>
            <span>Basic Information</span>
            <span className="shot-label">Features</span>
            <span>App Home</span>
            <span className="shot-hl shot-rel shot-fit">
              Incoming Webhooks
              <Mark n={1} className="shot-mark-right" />
            </span>
            <span>OAuth &amp; Permissions</span>
          </div>
          <div className="cg-page">
            <span className="shot-kv">
              <b>Activate Incoming Webhooks</b>
              <span className="shot-toggle shot-hl shot-rel">
                <span />
                <Mark n={2} className="shot-mark-left" />
              </span>
            </span>
            <span className="shot-label">Webhook URLs for Your Workspace</span>
            <span className="shot-muted">No webhooks have been added yet.</span>
            <span className="shot-btn shot-hl shot-rel shot-self-start">
              Add New Webhook
              <Mark n={3} className="shot-mark-right" />
            </span>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

function SlackCopyShot() {
  return (
    <Figure caption="Illustration. After Allow, Slack brings you back to the Incoming Webhooks page with your new link.">
      <Window url="slack.com/oauth" app="sl">
        <div className="cg-page">
          <div className="cg-pair-cards">
            <div className="shot-popup">
              <b>Stockwatcher wants to post in My workspace</b>
              <span className="shot-label">Where should it post?</span>
              <span className="shot-select shot-hl shot-rel">
                # alerts <ChevronDown size={11} />
                <Mark n={1} className="shot-mark-right" />
              </span>
              <span className="shot-actions">
                <span className="shot-btn">Cancel</span>
                <span className="shot-btn shot-btn-primary shot-hl shot-rel">
                  Allow
                  <Mark n={2} className="shot-mark-right" />
                </span>
              </span>
            </div>
            <div className="shot-popup">
              <span className="shot-label">Webhook URL</span>
              <span className="shot-kv">
                <span className="shot-token">
                  https://hooks.slack.com/services/T0…
                </span>
                <span className="shot-btn shot-hl shot-rel">
                  Copy
                  <Mark n={3} className="shot-mark-below" />
                </span>
              </span>
              <span className="shot-muted"># alerts · added by you</span>
            </div>
          </div>
        </div>
      </Window>
    </Figure>
  );
}

/* ── ntfy ────────────────────────────────────────────────── */

function NtfyPreview() {
  return (
    <Figure caption="Illustration. Alerts show up like any other notification, even when the phone is locked.">
      <Phone app="nt">
        <div className="cg-lock">
          <span className="cg-lock-time">9:41</span>
          <span className="cg-lock-date">Tuesday 24 November</span>
          <div className="cg-notice">
            <span className="cg-notice-app">
              <span className="cg-app-icon">
                <BellRing size={10} />
              </span>
              ntfy <span className="shot-muted">now</span>
            </span>
            <b>{sample.title}</b>
            <span>{sample.body}</span>
          </div>
        </div>
      </Phone>
    </Figure>
  );
}

function StoreShot() {
  return (
    <Figure caption="Illustration. The app is free. Look for the icon with a bell.">
      <Phone
        app="nt"
        head={
          <div className="cg-head">
            <span className="cg-search">
              <Search size={11} /> ntfy
            </span>
          </div>
        }
      >
        <div className="cg-store">
          <span className="cg-app-icon cg-app-icon-lg">
            <BellRing size={18} />
          </span>
          <span className="cg-who">
            <b>ntfy</b>
            <small>Push notifications for any app</small>
          </span>
          <span className="cg-get shot-hl shot-rel">
            Get
            <Mark n={1} className="shot-mark-below" />
          </span>
        </div>
      </Phone>
    </Figure>
  );
}

function SubscribeShot({ topic }: { topic: string }) {
  return (
    <Figure caption="Illustration. On Android, leave “Use another server” switched off.">
      <Phone
        app="nt"
        head={
          <div className="cg-head">
            <b>Subscribed topics</b>
          </div>
        }
      >
        <p className="cg-system">You haven’t subscribed to any topics yet.</p>
        <span className="cg-fab shot-hl shot-rel">
          <Plus size={16} />
          <Mark n={1} className="shot-mark-left" />
        </span>
      </Phone>
      <Phone
        app="nt"
        head={
          <div className="cg-head">
            <b>Subscribed topics</b>
          </div>
        }
      >
        <div className="cg-sheet">
          <b>Subscribe to topic</b>
          <span className="shot-input cg-topic-input shot-hl shot-rel">
            {topic}
            <Mark n={2} className="shot-mark-above" />
          </span>
          <span className="shot-check">
            <span className="shot-box" /> Use another server
          </span>
          <span className="shot-actions">
            <span className="shot-muted">Cancel</span>
            <span className="cg-accent-text shot-hl shot-rel">
              Subscribe
              <Mark n={3} className="shot-mark-right" />
            </span>
          </span>
        </div>
      </Phone>
    </Figure>
  );
}

/* ── Webhook ─────────────────────────────────────────────── */

const examplePayload = `{
  "event": "stockwatcher.alert",
  "sentAt": "2026-11-24T14:41:07.000Z",
  "title": "AAPL · Price ≥ 250",
  "body": "Apple Inc. is at 251.30 USD (+2.10% today).",
  "url": "https://…/#alerts",
  "tone": "up",
  "data": { "Symbol": "AAPL", "Price": "251.30 USD" }
}`;

function WebhookPreview() {
  return (
    <Figure
      caption={
        <>
          Example request. <code>tone</code> is <code>up</code>,{" "}
          <code>down</code> or <code>info</code>; <code>data</code> varies by
          alert.
        </>
      }
    >
      <Window url="POST https://your-endpoint" app="hook">
        <pre className="cg-code">
          <span className="shot-muted">
            Content-Type: application/json{"\n"}
            X-Stockwatcher-Signature: sha256=9f2c…{"\n\n"}
          </span>
          {examplePayload}
        </pre>
      </Window>
    </Figure>
  );
}

/* ── Guide ───────────────────────────────────────────────── */

type Panel = "telegram-chat" | "ntfy-topic";

type Step = {
  rail: string;
  title: string;
  body: ReactNode;
  shot?: ReactNode;
  fields?: FieldName[];
  panel?: Panel;
  open?: { href: string; text: string }[];
  final?: boolean;
};

function intro({
  title,
  lead,
  need,
  time,
  extra,
  preview,
}: {
  title: string;
  lead: ReactNode;
  need: ReactNode;
  time: string;
  extra?: ReactNode;
  preview: ReactNode;
}): Step {
  return {
    rail: "Before you start",
    title,
    body: (
      <>
        <p>{lead}</p>
        <ul className="guide-points">
          <li>
            <Check size={16} />
            <span>
              <b>You’ll need</b> {need}
            </span>
          </li>
          <li>
            <Clock size={16} />
            <span>
              <b>{time}.</b> You only do this once.
            </span>
          </li>
          <li>
            <ShieldCheck size={16} />
            <span>
              <b>Private.</b> Stored encrypted. Stockwatcher only sends alert
              messages.
            </span>
          </li>
          {extra}
        </ul>
      </>
    ),
    shot: preview,
  };
}

const finalStep = (body: ReactNode, shot?: ReactNode): Step => ({
  rail: "Test and save",
  title: "Send a test and save",
  body,
  shot,
  fields: ["label"],
  final: true,
});

function guideSteps(
  kind: ChannelKind,
  {
    emailReady,
    bot,
    topic,
  }: { emailReady: boolean; bot: string | null; topic: string },
): Step[] {
  switch (kind) {
    case "email":
      return [
        intro({
          title: "Get alerts by email",
          lead: "Alerts arrive as a short email with the price, the change and a link back to Stockwatcher.",
          need: "the email address you want alerts sent to.",
          time: channelMeta.email.time,
          extra: emailReady ? null : (
            <li className="cg-warn">
              <CircleAlert size={16} />
              <span>
                <b>Email isn’t set up on this server yet.</b> You can read
                through the steps, but saving is switched off. Pick another
                channel for now.
              </span>
            </li>
          ),
          preview: <EmailPreview />,
        }),
        {
          rail: "Your address",
          title: "Where should alerts go?",
          body: (
            <p>
              Alerts are sent from <b>{sender}</b>. Use any address you check
              regularly.
            </p>
          ),
          fields: ["address"],
        },
        finalStep(
          <ol className="guide-actions">
            <li>
              Stockwatcher sends a test email now. It’s saved only if the email
              goes out.
            </li>
            <li>
              If the test isn’t in your inbox within a minute: <Mark n={1} />{" "}
              open <b>Spam</b>, <Mark n={2} /> open the test email,{" "}
              <Mark n={3} /> press <b>Not spam</b>. You only need to do this
              once.
            </li>
          </ol>,
          <SpamShot />,
        ),
      ];
    case "whatsapp":
      return [
        intro({
          title: "Get alerts on WhatsApp",
          lead: "Alerts arrive as WhatsApp messages from CallMeBot, a free service that forwards messages to your own number.",
          need: "your phone with WhatsApp.",
          time: channelMeta.whatsapp.time,
          extra: (
            <li>
              <Info size={16} />
              <span>
                CallMeBot is a free third-party service meant for personal use.
                Messages can occasionally be delayed by a few minutes.
              </span>
            </li>
          ),
          preview: <WhatsAppPreview />,
        }),
        {
          rail: "Add CallMeBot",
          title: "Add CallMeBot to your contacts",
          body: (
            <ol className="guide-actions">
              <li>
                Open the CallMeBot page with the button below and find their
                current WhatsApp number. It sometimes changes, so always take it
                from there.
              </li>
              <li>
                On your phone, create a new contact: <Mark n={1} /> name it{" "}
                <b>CallMeBot</b>, <Mark n={2} /> enter that number,{" "}
                <Mark n={3} /> press <b>Save</b>.
              </li>
            </ol>
          ),
          open: [
            { href: links.callmebot, text: "Open CallMeBot instructions" },
          ],
          shot: <ContactShot />,
        },
        {
          rail: "Send the message",
          title: "Send CallMeBot this exact message",
          body: (
            <ol className="guide-actions">
              <li>Open WhatsApp and start a chat with CallMeBot.</li>
              <li>
                <Mark n={1} /> Type the sentence below exactly as written.{" "}
                <Mark n={2} /> Press send.
              </li>
            </ol>
          ),
          shot: <PermissionShot />,
        },
        {
          rail: "Copy your key",
          title: "Copy the API key from the reply",
          body: (
            <ol className="guide-actions">
              <li>
                CallMeBot replies with “API Activated”. <Mark n={1} /> The
                number at the end is your API key.
              </li>
              <li>
                Enter your own WhatsApp number and that key below. If no reply
                comes within a few minutes, send the sentence again.
              </li>
            </ol>
          ),
          shot: <KeyShot />,
          fields: ["phone", "apikey"],
        },
        finalStep(
          <p>
            Stockwatcher sends a test message to your WhatsApp now. It’s saved
            only if CallMeBot accepts the message.
          </p>,
        ),
      ];
    case "telegram":
      return [
        intro({
          title: "Get alerts on Telegram",
          lead: "You create a small private bot that only you talk to. Stockwatcher sends alerts through it.",
          need: "Telegram on your phone or computer.",
          time: channelMeta.telegram.time,
          preview: <TelegramPreview />,
        }),
        {
          rail: "Create a bot",
          title: "Create your bot with BotFather",
          body: (
            <ol className="guide-actions">
              <li>
                Open <b>@BotFather</b> in Telegram with the button below and
                press <b>Start</b>.
              </li>
              <li>
                <Mark n={1} /> Send <b>/newbot</b>.
              </li>
              <li>
                <Mark n={2} /> Send any name, for example{" "}
                <b>Stockwatcher alerts</b>.
              </li>
              <li>
                <Mark n={3} /> Send a username ending in <b>bot</b>, for example{" "}
                <b>my_stockwatcher_bot</b>. Try another if it’s taken.
              </li>
              <li>
                <Mark n={4} /> Copy the token from BotFather’s last message and
                paste it below.
              </li>
            </ol>
          ),
          open: [{ href: links.botfather, text: "Open @BotFather" }],
          shot: <BotFatherShot />,
          fields: ["token"],
        },
        {
          rail: "Message your bot",
          title: "Say hello to your bot",
          body: (
            <ol className="guide-actions">
              <li>
                {bot ? (
                  <>
                    Open <b>@{bot}</b> with the button below.
                  </>
                ) : (
                  <>Search Telegram for your bot’s username and open it.</>
                )}
              </li>
              <li>
                <Mark n={1} /> Press <b>Start</b>, or send <b>hi</b>.
              </li>
              <li>
                Come back here and press <b>Find my chat</b>.
              </li>
            </ol>
          ),
          open: bot
            ? [{ href: `https://t.me/${bot}`, text: `Open @${bot}` }]
            : undefined,
          shot: <StartShot bot={bot} />,
          panel: "telegram-chat",
        },
        finalStep(
          <p>
            Stockwatcher sends a test message through your bot now. It’s saved
            only if Telegram delivers it.
          </p>,
        ),
      ];
    case "discord":
      return [
        intro({
          title: "Get alerts in Discord",
          lead: "Alerts are posted in a Discord channel through a webhook, a private link that can only post messages.",
          need: "a Discord server where you can manage channels.",
          time: channelMeta.discord.time,
          preview: <DiscordPreview />,
        }),
        {
          rail: "Open Integrations",
          title: "Open the channel’s Integrations",
          body: (
            <ol className="guide-actions">
              <li>
                In Discord, point at the channel you want alerts in.{" "}
                <Mark n={1} /> Click the <b>gear</b> (Edit Channel) next to its
                name.
              </li>
              <li>
                <Mark n={2} /> In the menu on the left, click{" "}
                <b>Integrations</b>.
              </li>
              <li className="guide-optional">
                You can also go through Server Settings → Integrations.
              </li>
            </ol>
          ),
          shot: <DiscordSettingsShot />,
        },
        {
          rail: "Copy the webhook",
          title: "Create a webhook and copy its link",
          body: (
            <ol className="guide-actions">
              <li>
                Click <b>Webhooks</b>, then <Mark n={1} /> <b>New Webhook</b>.
              </li>
              <li>
                <Mark n={2} /> Click the new webhook and name it{" "}
                <b>Stockwatcher</b>. <Mark n={3} /> Check the channel.
              </li>
              <li>
                <Mark n={4} /> Click <b>Copy Webhook URL</b> and paste it below.
              </li>
            </ol>
          ),
          shot: <DiscordWebhookShot />,
          fields: ["url"],
        },
        finalStep(
          <p>
            Stockwatcher posts a test message in your channel now. It’s saved
            only if Discord accepts it.
          </p>,
        ),
      ];
    case "slack":
      return [
        intro({
          title: "Get alerts in Slack",
          lead: "Alerts are posted in a Slack channel through an incoming webhook, a private link that can only post messages.",
          need: "a Slack workspace where you’re allowed to add apps.",
          time: channelMeta.slack.time,
          preview: <SlackPreview />,
        }),
        {
          rail: "Create an app",
          title: "Create a Slack app",
          body: (
            <ol className="guide-actions">
              <li>Open Slack’s app page with the button below.</li>
              <li>
                <Mark n={1} /> Click <b>Create New App</b>. <Mark n={2} />{" "}
                Choose <b>From scratch</b>.
              </li>
              <li>
                Name it <b>Stockwatcher</b>, pick your workspace and{" "}
                <Mark n={3} /> click <b>Create App</b>.
              </li>
            </ol>
          ),
          open: [{ href: links.slackApps, text: "Open api.slack.com/apps" }],
          shot: <SlackCreateShot />,
        },
        {
          rail: "Turn on webhooks",
          title: "Turn on Incoming Webhooks",
          body: (
            <ol className="guide-actions">
              <li>
                <Mark n={1} /> In the left menu, click <b>Incoming Webhooks</b>.
              </li>
              <li>
                <Mark n={2} /> Switch <b>Activate Incoming Webhooks</b> on.
              </li>
              <li>
                <Mark n={3} /> Scroll down and click <b>Add New Webhook</b> (it
                may say “to Workspace”).
              </li>
            </ol>
          ),
          shot: <SlackHooksShot />,
        },
        {
          rail: "Copy the link",
          title: "Pick a channel and copy the link",
          body: (
            <ol className="guide-actions">
              <li>
                <Mark n={1} /> Choose the channel for alerts. <Mark n={2} />{" "}
                Click <b>Allow</b>.
              </li>
              <li>
                <Mark n={3} /> Next to the new Webhook URL, click <b>Copy</b>{" "}
                and paste it below.
              </li>
            </ol>
          ),
          shot: <SlackCopyShot />,
          fields: ["url"],
        },
        finalStep(
          <p>
            Stockwatcher posts a test message in your channel now. It’s saved
            only if Slack accepts it.
          </p>,
        ),
      ];
    case "ntfy":
      return [
        intro({
          title: "Get push notifications on your phone",
          lead: "Alerts arrive as phone notifications through ntfy, a free app that needs no account.",
          need: "your iPhone or Android phone.",
          time: channelMeta.ntfy.time,
          preview: <NtfyPreview />,
        }),
        {
          rail: "Install ntfy",
          title: "Install the ntfy app",
          body: (
            <ol className="guide-actions">
              <li>
                On your phone, open the App Store or Google Play and search for{" "}
                <b>ntfy</b>. <Mark n={1} /> Install it.
              </li>
              <li>Open it once and allow notifications when it asks.</li>
            </ol>
          ),
          open: [
            { href: links.ntfyIos, text: "App Store (iPhone)" },
            { href: links.ntfyAndroid, text: "Google Play (Android)" },
          ],
          shot: <StoreShot />,
        },
        {
          rail: "Subscribe",
          title: "Subscribe to your private topic",
          body: (
            <ol className="guide-actions">
              <li>
                In ntfy, <Mark n={1} /> tap <b>+</b>.
              </li>
              <li>
                <Mark n={2} /> Type the topic below exactly. <Mark n={3} /> Tap{" "}
                <b>Subscribe</b>.
              </li>
              <li className="guide-optional">
                The topic works like a password: anyone who knows it can read
                your alerts. That’s why it’s long and random.
              </li>
            </ol>
          ),
          panel: "ntfy-topic",
          shot: <SubscribeShot topic={topic} />,
        },
        finalStep(
          <p>
            Stockwatcher sends a test notification to your phone now. It’s saved
            only if ntfy accepts it.
          </p>,
        ),
      ];
    case "webhook":
      return [
        intro({
          title: "Send alerts to a webhook",
          lead: "For automation tools such as Zapier, Make, n8n or Home Assistant. Each alert is sent as a signed JSON POST request.",
          need: "a public https endpoint that answers with a 2xx status.",
          time: channelMeta.webhook.time,
          preview: <WebhookPreview />,
        }),
        {
          rail: "Your endpoint",
          title: "Where should alerts be posted?",
          body: (
            <p>
              Stockwatcher signs every request. The{" "}
              <code>X-Stockwatcher-Signature</code> header is{" "}
              <code>sha256=</code> followed by the hex HMAC-SHA256 of the raw
              body. You get the secret once, after saving.
            </p>
          ),
          fields: ["url"],
        },
        finalStep(
          <p>
            Stockwatcher posts a test alert to your endpoint now. It’s saved
            only if your endpoint answers with a 2xx status.
          </p>,
        ),
      ];
  }
}

const errorHints: Record<ChannelKind, string> = {
  email:
    "Check the address for typos. If it’s right, the email service may be busy. Try again in a minute.",
  whatsapp:
    "Check that the number has the country code, is the one that messaged CallMeBot, and that the key is the number from its reply. If you just activated it, wait a minute and try again.",
  telegram:
    "Make sure you pressed Start in your bot’s chat. If you made a new token in BotFather, paste the newest one.",
  discord:
    "If the webhook was deleted in Discord, create a new one and copy its link again.",
  slack:
    "Slack links stop working when the app is removed. Add a new webhook and copy it again.",
  ntfy: "Check the topic. If you use your own server, check its address and token under Advanced.",
  webhook:
    "Your endpoint must be public and answer with a 2xx status within a few seconds. Check its logs for the test request.",
};

function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? <Check /> : <Copy />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}

function mask(value: string, keep = 4) {
  return value.length <= keep ? value : `•••• ${value.slice(-keep)}`;
}

function shortUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.host}/…${value.slice(-4)}`;
  } catch {
    return value;
  }
}

export function ChannelGuide({
  kind,
  close,
  created,
  emailReady,
  defaultEmail,
}: {
  kind: ChannelKind;
  close: () => void;
  created: (channel: Channel) => void;
  emailReady: boolean;
  defaultEmail: string | null;
}) {
  const meta = channelMeta[kind];
  const [index, setIndex] = useState(0);
  const main = useRef<HTMLFormElement>(null);
  // Autofocusing a field further down would otherwise scroll the step's title out of view.
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [index]);
  const [values, setValues] = useState<Values>(() => ({
    address: defaultEmail ?? "",
    phone: "",
    apikey: "",
    token: "",
    chatId: "",
    url: "",
    topic: kind === "ntfy" ? randomTopic() : "",
    server: "",
    ntfyToken: "",
    label: "",
  }));
  const [bot, setBot] = useState<string | null>(null);
  const [chatName, setChatName] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [findNote, setFindNote] = useState<string>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error>();
  const [secret, setSecret] = useState<string | null>(null);

  const steps = guideSteps(kind, { emailReady, bot, topic: values.topic });
  const step = steps[index]!;
  const busy = working || finding;
  const ok = (name: FieldName) => valid(kind, name, values[name]);
  const allOk = required[kind].every(ok) && ok("ntfyToken") && ok("label");
  const blocked = kind === "email" && !emailReady;
  const stepOk =
    (step.fields ?? []).every(ok) &&
    (step.panel === "ntfy-topic"
      ? ok("topic") && ok("server") && ok("ntfyToken")
      : true);
  const canAdvance = step.final ? allOk && !busy && !blocked : stepOk && !busy;

  const set = (name: FieldName, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (name === "token") {
      setBot(null);
      setChatName(null);
    }
    if (name === "chatId") setChatName(null);
  };

  const go = (next: number) => {
    setError(undefined);
    setFindNote(undefined);
    setIndex(Math.max(0, Math.min(steps.length - 1, next)));
  };

  const lookup = async () => {
    const result = await api<{
      bot: string | null;
      chat: { id: string; name: string } | null;
    }>("/api/alerts/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: values.token.trim() }),
    });
    setBot(result.bot);
    if (result.chat) {
      setValues((current) => ({
        ...current,
        chatId: result.chat?.id ?? current.chatId,
      }));
      setChatName(result.chat.name);
    }
    return result;
  };

  const findChat = async () => {
    setFinding(true);
    setError(undefined);
    setFindNote(undefined);
    try {
      const result = await lookup();
      if (!result.chat)
        setFindNote(
          "No message found yet. Press Start or send “hi” to your bot in Telegram, then try again.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error("Telegram didn’t answer."),
      );
    } finally {
      setFinding(false);
    }
  };

  const verifyToken = async () => {
    setFinding(true);
    setError(undefined);
    try {
      await lookup();
      go(index + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error("Telegram didn’t answer."),
      );
    } finally {
      setFinding(false);
    }
  };

  const submit = async () => {
    setWorking(true);
    setError(undefined);
    try {
      const result = await api<{ channel: Channel | null; secret?: string }>(
        "/api/alerts/channels",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload(kind, values)),
        },
      );
      if (result.channel) created(result.channel);
      if (result.secret) setSecret(result.secret);
      else close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error("The test message didn’t go through."),
      );
    } finally {
      setWorking(false);
    }
  };

  const next = () => {
    if (!canAdvance) return;
    if (step.final) void submit();
    else if (kind === "telegram" && step.fields?.includes("token") && !bot)
      void verifyToken();
    else go(index + 1);
  };

  const fieldStep = (name: FieldName) =>
    steps.findIndex(
      (item) =>
        item.fields?.includes(name) ||
        (name === "chatId" && item.panel === "telegram-chat") ||
        (name === "topic" && item.panel === "ntfy-topic"),
    );

  const field = (name: FieldName, focus: boolean) => {
    const spec = fieldSpec(kind, name);
    const value = values[name];
    const bad = value.trim() !== "" && !ok(name);
    const id = `cg-${name}`;
    return (
      <label className="guide-input" key={name} htmlFor={id}>
        <span>{spec.label}</span>
        <Input
          id={id}
          autoFocus={focus}
          type={spec.type ?? "text"}
          inputMode={spec.inputMode}
          autoComplete={name === "address" ? "email" : "off"}
          readOnly={name === "address" && Boolean(defaultEmail)}
          spellCheck={false}
          placeholder={spec.placeholder}
          value={value}
          aria-invalid={bad || undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) =>
            set(
              name,
              spec.clean ? spec.clean(event.target.value) : event.target.value,
            )
          }
        />
        <small id={`${id}-hint`} className={cn(bad && "guide-bad")}>
          {bad ? spec.bad : spec.hint}
        </small>
      </label>
    );
  };

  const missing = (name: FieldName) => {
    const at = fieldStep(name);
    return (
      <button type="button" onClick={() => go(at)}>
        Missing. Go to step {at + 1}
      </button>
    );
  };

  const summary: { term: string; value: ReactNode }[] = (() => {
    const show = (name: FieldName, text: string) =>
      ok(name) && values[name].trim() ? text : missing(name);
    switch (kind) {
      case "email":
        return [
          { term: "Address", value: show("address", values.address.trim()) },
        ];
      case "whatsapp":
        return [
          { term: "Phone", value: show("phone", stripPhone(values.phone)) },
          { term: "API key", value: show("apikey", mask(values.apikey, 2)) },
        ];
      case "telegram":
        return [
          {
            term: "Bot",
            value: show("token", bot ? `@${bot}` : mask(values.token)),
          },
          { term: "Chat", value: show("chatId", chatName ?? values.chatId) },
        ];
      case "discord":
      case "slack":
        return [
          { term: "Webhook", value: show("url", shortUrl(values.url.trim())) },
        ];
      case "ntfy":
        return [
          { term: "Topic", value: show("topic", values.topic) },
          { term: "Server", value: values.server.trim() || "ntfy.sh" },
        ];
      case "webhook":
        return [{ term: "Endpoint", value: show("url", values.url.trim()) }];
    }
  })();

  if (secret)
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
        <DialogContent className="ibkr-guide cg-done sm:max-w-[720px]">
          <div className="guide-main">
            <p className="guide-count">Saved</p>
            <DialogTitle className="guide-title">
              Copy your signing secret
            </DialogTitle>
            <DialogDescription asChild>
              <div className="guide-body">
                <p>
                  The test alert reached your endpoint and the webhook is saved.
                  This secret is shown <b>only once</b>. Store it with your
                  endpoint to check that requests really come from Stockwatcher.
                </p>
              </div>
            </DialogDescription>
            <div className="cg-big">
              <code>{secret}</code>
              <CopyButton text={secret} label="Copy secret" />
            </div>
            <ul className="guide-points">
              <li>
                <ShieldCheck size={16} />
                <span>
                  Every request has the header{" "}
                  <code>X-Stockwatcher-Signature: sha256=&lt;hex&gt;</code>,
                  where <code>&lt;hex&gt;</code> is the HMAC-SHA256 of the raw
                  request body, keyed with this secret.
                </span>
              </li>
              <li>
                <Check size={16} />
                <span>
                  Compute the same HMAC on your side and compare it in constant
                  time before trusting the request.
                </span>
              </li>
            </ul>
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
        if (!open && !working) close();
      }}
    >
      <DialogContent
        className="ibkr-guide sm:max-w-[1080px]"
        showCloseButton={!working}
      >
        <nav className="guide-rail" aria-label="Setup steps">
          <p className="guide-rail-head">
            <meta.icon size={13} aria-hidden /> Set up {meta.name}
          </p>
          <ol>
            {steps.map((item, i) => (
              <li key={item.rail}>
                <button
                  type="button"
                  aria-current={i === index ? "step" : undefined}
                  className={cn(i < index && "done")}
                  disabled={busy}
                  onClick={() => go(i)}
                >
                  <span className="guide-num">
                    {i < index ? <Check size={12} /> : i + 1}
                  </span>
                  {item.rail}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <form
          ref={main}
          className="guide-main"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            next();
          }}
        >
          <div className="guide-progress" aria-hidden>
            <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
          <p className="guide-count">
            Step {index + 1} of {steps.length}
          </p>
          <DialogTitle className="guide-title">{step.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="guide-body">{step.body}</div>
          </DialogDescription>
          {step.open ? (
            <div className="cg-open">
              {step.open.map((link) => (
                <Button key={link.href} asChild variant="outline">
                  <a href={link.href} target="_blank" rel="noreferrer">
                    {link.text} <ExternalLink />
                  </a>
                </Button>
              ))}
            </div>
          ) : null}
          {kind === "whatsapp" && step.rail === "Send the message" ? (
            <div className="cg-big">
              <code>{permissionText}</code>
              <CopyButton text={permissionText} />
            </div>
          ) : null}
          {step.panel === "ntfy-topic" ? (
            <>
              <div className="cg-big">
                <code>{values.topic}</code>
                <CopyButton text={values.topic} />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => set("topic", randomTopic())}
                >
                  <RefreshCw /> New topic
                </Button>
              </div>
              <details className="cg-advanced">
                <summary>
                  <ChevronDown size={14} aria-hidden /> Advanced: topic name,
                  own server or token
                </summary>
                <div className="cg-advanced-body">
                  {field("topic", false)}
                  {field("server", false)}
                  {field("ntfyToken", false)}
                </div>
              </details>
            </>
          ) : null}
          {step.shot}
          {step.panel === "telegram-chat" ? (
            <div className="guide-input cg-find">
              <span>Your chat</span>
              <div className="cg-find-row">
                <Button
                  type="button"
                  disabled={!ok("token") || finding}
                  onClick={() => void findChat()}
                >
                  <Search /> {finding ? "Looking…" : "Find my chat"}
                </Button>
                <span aria-live="polite" className="cg-find-result">
                  {chatName && ok("chatId") ? (
                    <>
                      <Check size={15} /> Found <b>{chatName}</b>
                    </>
                  ) : !values.token ? (
                    <span className="shot-muted">
                      Add the bot token in step 2 first.
                    </span>
                  ) : null}
                </span>
              </div>
              {findNote ? <small>{findNote}</small> : null}
              <details className="cg-advanced">
                <summary>
                  <ChevronDown size={14} aria-hidden /> Enter the chat ID
                  yourself
                </summary>
                <div className="cg-advanced-body">{field("chatId", false)}</div>
              </details>
            </div>
          ) : null}
          {step.fields?.map((name, i) => field(name, i === 0 && !step.final))}
          {step.final ? (
            <dl className="guide-summary">
              <div>
                <dt>Channel</dt>
                <dd>{meta.name}</dd>
              </div>
              {summary.map((row) => (
                <div key={row.term}>
                  <dt>{row.term}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {step.final && blocked ? (
            <p className="guide-help guide-bad">
              Email isn’t set up on this server yet, so this channel can’t be
              saved. Pick another channel for now.
            </p>
          ) : null}
          <Failure error={error} />
          {error && step.final ? (
            <p className="guide-help">{errorHints[kind]}</p>
          ) : null}
          <div className="guide-footer">
            <Button
              type="button"
              variant="ghost"
              disabled={index === 0 || busy}
              onClick={() => go(index - 1)}
            >
              <ArrowLeft /> Back
            </Button>
            <Button type="submit" size="lg" disabled={!canAdvance}>
              {step.final ? (
                working ? (
                  "Sending test…"
                ) : (
                  "Send test and save"
                )
              ) : finding ? (
                "Checking…"
              ) : (
                <>
                  {index === 0 ? "Start" : "Next"} <ArrowRight />
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
