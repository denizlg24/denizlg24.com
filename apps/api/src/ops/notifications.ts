import type { Database } from "@repo/cloud-core";
import { notificationEvents } from "@repo/cloud-core/db/schema";
import {
  NOTIFICATION_COOLDOWN_MINUTES,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationPayload,
} from "@repo/schemas/cloud";
import { eq, sql } from "drizzle-orm";

/**
 * Only the shape these notifiers call. Bun's `typeof fetch` also carries
 * `preconnect`, which a stub has no reason to implement.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface Notifier {
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  send(payload: NotificationPayload): Promise<boolean>;
}

function plainText(payload: NotificationPayload): string {
  const lines = [payload.message];
  if (payload.details) {
    for (const [key, value] of Object.entries(payload.details)) {
      lines.push(`${key}: ${value}`);
    }
  }
  if (payload.url) lines.push(payload.url);
  return lines.join("\n");
}

export class WebhookNotifier implements Notifier {
  readonly channel = "webhook" as const;

  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly fetchImplementation: FetchLike = fetch,
  ) {}

  get enabled(): boolean {
    return Boolean(this.webhookUrl);
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.webhookUrl) return false;
    const response = await this.fetchImplementation(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        // Slack incoming webhooks render `text` and ignore everything else; the
        // structured fields stay for any other webhook consumer.
        text: `${payload.title}\n${plainText(payload)}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Notification webhook returned HTTP ${response.status}`);
    }
    return true;
  }
}

export interface EmailNotifierOptions {
  apiKey: string | undefined;
  from: string | undefined;
  to: string | undefined;
  fetchImplementation?: FetchLike;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const SEVERITY_PREFIX = {
  info: "",
  warn: "[warn] ",
  error: "[alert] ",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlBody(payload: NotificationPayload): string {
  const rows = Object.entries(payload.details ?? {})
    .map(
      ([key, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(key)}</td><td style="font-family:ui-monospace,monospace">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return [
    `<h2 style="margin:0 0 12px;font-size:16px">${escapeHtml(payload.title)}</h2>`,
    `<pre style="margin:0 0 12px;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px">${escapeHtml(payload.message)}</pre>`,
    rows ? `<table style="font-size:13px">${rows}</table>` : "",
    payload.url
      ? `<p style="margin:12px 0 0"><a href="${escapeHtml(payload.url)}">${escapeHtml(payload.url)}</a></p>`
      : "",
  ].join("");
}

/**
 * Resend over plain fetch — the Pi API is Bun/Hono, and adding an SDK (or
 * nodemailer plus SMTP credentials on the host) for one POST is not worth the
 * dependency.
 */
export class EmailNotifier implements Notifier {
  readonly channel = "email" as const;
  private readonly fetchImplementation: FetchLike;

  constructor(private readonly options: EmailNotifierOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  get enabled(): boolean {
    return Boolean(this.options.apiKey && this.options.from && this.options.to);
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    const { apiKey, from, to } = this.options;
    if (!apiKey || !from || !to) return false;
    const response = await this.fetchImplementation(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${SEVERITY_PREFIX[payload.severity]}${payload.title}`,
        text: plainText(payload),
        html: htmlBody(payload),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Resend returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    return true;
  }
}

/**
 * Cooldown bookkeeping, injected so the fan-out logic is testable without
 * standing up Postgres.
 */
export interface NotificationClaimStore {
  /** Records the sighting and reports whether the cooldown has elapsed. */
  claim(
    eventKey: string,
    payload: NotificationPayload,
    now: Date,
    cooldownMs: number,
  ): Promise<boolean>;
  markSent(eventKey: string, now: Date): Promise<void>;
}

export interface NotificationDispatcherOptions {
  claims: NotificationClaimStore;
  notifiers: readonly Notifier[];
  /** Overridable so tests do not depend on the wall clock. */
  now?: () => Date;
}

export interface DispatchResult {
  suppressed: boolean;
  deliveries: NotificationDelivery[];
}

/**
 * Fans a payload out to every enabled channel, with the cooldown held in
 * Postgres rather than in memory. The in-memory Map this replaces meant a
 * redeploy mid-incident replayed every alert that had already gone out.
 */
export class NotificationDispatcher {
  private readonly claims: NotificationClaimStore;
  private readonly notifiers: readonly Notifier[];
  private readonly now: () => Date;

  constructor(options: NotificationDispatcherOptions) {
    this.claims = options.claims;
    this.notifiers = options.notifiers;
    this.now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return this.notifiers.some((notifier) => notifier.enabled);
  }

  get channels(): readonly NotificationChannel[] {
    return this.notifiers
      .filter((notifier) => notifier.enabled)
      .map((notifier) => notifier.channel);
  }

  async dispatch(
    payload: NotificationPayload,
    options: { cooldownMinutes?: number; force?: boolean } = {},
  ): Promise<DispatchResult> {
    const eventKey = `${payload.type}:${payload.subjectKey}`;
    const now = this.now();
    const cooldownMs =
      (options.cooldownMinutes ?? NOTIFICATION_COOLDOWN_MINUTES[payload.type]) *
      60_000;

    const claimed = await this.claims.claim(
      eventKey,
      payload,
      now,
      options.force === true ? 0 : cooldownMs,
    );
    if (!claimed) {
      return { suppressed: true, deliveries: [] };
    }

    const deliveries = await Promise.all(
      this.notifiers.map(async (notifier): Promise<NotificationDelivery> => {
        if (!notifier.enabled) {
          return {
            channel: notifier.channel,
            enabled: false,
            sent: false,
            error: null,
          };
        }
        try {
          const sent = await notifier.send(payload);
          return {
            channel: notifier.channel,
            enabled: true,
            sent,
            error: null,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `[notifications] ${notifier.channel} delivery failed`,
            error,
          );
          return {
            channel: notifier.channel,
            enabled: true,
            sent: false,
            error: message,
          };
        }
      }),
    );

    if (deliveries.some((delivery) => delivery.sent)) {
      await this.claims.markSent(eventKey, now).catch((error) => {
        console.error("[notifications] Failed to record send", error);
      });
    }

    return { suppressed: false, deliveries };
  }
}

/**
 * `last_sent_at` is advanced only once a channel has accepted the message, not
 * when the claim is taken. Claiming optimistically would be atomic, but a
 * transient Resend outage would then silence the event for its whole cooldown —
 * and with one scheduler in one container there is no concurrent writer for
 * atomicity to protect against.
 */
export function databaseClaimStore(db: Database): NotificationClaimStore {
  return {
    async claim(eventKey, payload, now, cooldownMs) {
      const cutoff = new Date(now.getTime() - cooldownMs);
      const rows = await db
        .insert(notificationEvents)
        .values({
          eventKey,
          type: payload.type,
          severity: payload.severity,
          firstSeenAt: now,
          lastSeenAt: now,
          lastPayload: payload,
        })
        .onConflictDoUpdate({
          target: notificationEvents.eventKey,
          set: {
            lastSeenAt: now,
            severity: payload.severity,
            lastPayload: payload,
            suppressedCount: sql`
              CASE
                WHEN ${notificationEvents.lastSentAt} IS NULL
                  OR ${notificationEvents.lastSentAt} <= ${cutoff.toISOString()}::timestamptz
                THEN ${notificationEvents.suppressedCount}
                ELSE ${notificationEvents.suppressedCount} + 1
              END
            `,
          },
        })
        .returning({ lastSentAt: notificationEvents.lastSentAt });

      const lastSentAt = rows[0]?.lastSentAt ?? null;
      return lastSentAt === null || lastSentAt.getTime() <= cutoff.getTime();
    },

    async markSent(eventKey, now) {
      await db
        .update(notificationEvents)
        .set({
          lastSentAt: now,
          sendCount: sql`${notificationEvents.sendCount} + 1`,
        })
        .where(eq(notificationEvents.eventKey, eventKey));
    },
  };
}
