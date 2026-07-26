import { describe, expect, it } from "bun:test";
import type { NotificationPayload } from "@repo/schemas/cloud";

import {
  EmailNotifier,
  type NotificationClaimStore,
  NotificationDispatcher,
  type Notifier,
  WebhookNotifier,
} from "./notifications";

function payload(
  overrides: Partial<NotificationPayload> = {},
): NotificationPayload {
  return {
    type: "disk_usage_high",
    severity: "warn",
    subjectKey: "/dev/nvme0n1p1",
    title: "Disk filling",
    message: "/dev/nvme0n1p1 at 91.2%",
    ...overrides,
  };
}

/** Always claims; records what was asked so tests can assert the cooldown. */
function openClaims(): NotificationClaimStore & {
  claims: { eventKey: string; cooldownMs: number }[];
  sent: string[];
} {
  const claims: { eventKey: string; cooldownMs: number }[] = [];
  const sent: string[] = [];
  return {
    claims,
    sent,
    async claim(eventKey, _payload, _now, cooldownMs) {
      claims.push({ eventKey, cooldownMs });
      return true;
    },
    async markSent(eventKey) {
      sent.push(eventKey);
    },
  };
}

function closedClaims(): NotificationClaimStore {
  return {
    async claim() {
      return false;
    },
    async markSent() {},
  };
}

function stubNotifier(
  channel: "email" | "webhook",
  behaviour: "ok" | "throw" | "disabled",
): Notifier & { calls: NotificationPayload[] } {
  const calls: NotificationPayload[] = [];
  return {
    calls,
    channel,
    enabled: behaviour !== "disabled",
    async send(input) {
      calls.push(input);
      if (behaviour === "throw") throw new Error(`${channel} exploded`);
      return true;
    },
  };
}

describe("NotificationDispatcher", () => {
  it("fans out to every enabled channel", async () => {
    const email = stubNotifier("email", "ok");
    const webhook = stubNotifier("webhook", "ok");
    const claims = openClaims();
    const dispatcher = new NotificationDispatcher({
      claims,
      notifiers: [email, webhook],
    });

    const result = await dispatcher.dispatch(payload());

    expect(result.suppressed).toBe(false);
    expect(email.calls).toHaveLength(1);
    expect(webhook.calls).toHaveLength(1);
    expect(result.deliveries.every((delivery) => delivery.sent)).toBe(true);
    expect(claims.sent).toEqual(["disk_usage_high:/dev/nvme0n1p1"]);
  });

  it("suppresses inside the cooldown without calling any channel", async () => {
    const email = stubNotifier("email", "ok");
    const dispatcher = new NotificationDispatcher({
      claims: closedClaims(),
      notifiers: [email],
    });

    const result = await dispatcher.dispatch(payload());

    expect(result.suppressed).toBe(true);
    expect(result.deliveries).toEqual([]);
    expect(email.calls).toHaveLength(0);
  });

  it("uses the type's default cooldown, and the override when given", async () => {
    const claims = openClaims();
    const dispatcher = new NotificationDispatcher({
      claims,
      notifiers: [stubNotifier("webhook", "ok")],
    });

    await dispatcher.dispatch(payload());
    await dispatcher.dispatch(payload(), { cooldownMinutes: 15 });
    await dispatcher.dispatch(payload(), { force: true });

    expect(claims.claims.map((claim) => claim.cooldownMs)).toEqual([
      360 * 60_000,
      15 * 60_000,
      0,
    ]);
  });

  it("keeps delivering when one channel fails, and reports the error", async () => {
    const email = stubNotifier("email", "throw");
    const webhook = stubNotifier("webhook", "ok");
    const claims = openClaims();
    const dispatcher = new NotificationDispatcher({
      claims,
      notifiers: [email, webhook],
    });

    const result = await dispatcher.dispatch(payload());

    expect(webhook.calls).toHaveLength(1);
    expect(result.deliveries).toEqual([
      { channel: "email", enabled: true, sent: false, error: "email exploded" },
      { channel: "webhook", enabled: true, sent: true, error: null },
    ]);
    // One channel accepting is enough to start the cooldown.
    expect(claims.sent).toHaveLength(1);
  });

  it("does not start the cooldown when every channel fails", async () => {
    const claims = openClaims();
    const dispatcher = new NotificationDispatcher({
      claims,
      notifiers: [stubNotifier("email", "throw")],
    });

    await dispatcher.dispatch(payload());

    expect(claims.sent).toHaveLength(0);
  });

  it("skips disabled channels without marking them failed", async () => {
    const email = stubNotifier("email", "disabled");
    const dispatcher = new NotificationDispatcher({
      claims: openClaims(),
      notifiers: [email],
    });

    const result = await dispatcher.dispatch(payload());

    expect(email.calls).toHaveLength(0);
    expect(result.deliveries).toEqual([
      { channel: "email", enabled: false, sent: false, error: null },
    ]);
  });

  it("is disabled when no channel is configured", () => {
    const dispatcher = new NotificationDispatcher({
      claims: openClaims(),
      notifiers: [stubNotifier("email", "disabled")],
    });

    expect(dispatcher.enabled).toBe(false);
    expect(dispatcher.channels).toEqual([]);
  });
});

describe("WebhookNotifier", () => {
  it("is disabled without a URL and sends nothing", async () => {
    const notifier = new WebhookNotifier(undefined);
    expect(notifier.enabled).toBe(false);
    expect(await notifier.send(payload())).toBe(false);
  });

  it("posts a Slack-compatible text field", async () => {
    const bodies: unknown[] = [];
    const notifier = new WebhookNotifier(
      "https://hooks.example/abc",
      async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      },
    );

    await notifier.send(payload({ details: { free: "4.2 GiB" } }));

    expect(bodies[0]).toMatchObject({
      type: "disk_usage_high",
      text: "Disk filling\n/dev/nvme0n1p1 at 91.2%\nfree: 4.2 GiB",
    });
  });

  it("throws on a non-2xx so the dispatcher records the failure", async () => {
    const notifier = new WebhookNotifier(
      "https://hooks.example/abc",
      async () => new Response(null, { status: 500 }),
    );

    expect(notifier.send(payload())).rejects.toThrow("HTTP 500");
  });
});

describe("EmailNotifier", () => {
  it("stays disabled unless key, from and to are all set", () => {
    const base = { apiKey: "re_x", from: "a@b.c", to: "d@e.f" };
    expect(new EmailNotifier(base).enabled).toBe(true);
    expect(new EmailNotifier({ ...base, apiKey: undefined }).enabled).toBe(
      false,
    );
    expect(new EmailNotifier({ ...base, to: undefined }).enabled).toBe(false);
  });

  it("prefixes the subject by severity and escapes the html body", async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const notifier = new EmailNotifier({
      apiKey: "re_x",
      from: "cloud@denizlg24.com",
      to: "deniz@example.com",
      fetchImplementation: async (url, init) => {
        requests.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: 200 });
      },
    });

    await notifier.send(
      payload({
        severity: "error",
        title: "Disk critical",
        message: "<script>alert(1)</script>",
      }),
    );

    const request = requests[0];
    expect(request?.url).toBe("https://api.resend.com/emails");
    expect(request?.body.subject).toBe("[alert] Disk critical");
    expect(request?.body.to).toEqual(["deniz@example.com"]);
    expect(String(request?.body.html)).not.toContain("<script>");
    expect(String(request?.body.html)).toContain("&lt;script&gt;");
    expect(String(request?.body.text)).toContain("<script>alert(1)</script>");
  });

  it("surfaces the Resend error body in the thrown message", async () => {
    const notifier = new EmailNotifier({
      apiKey: "re_x",
      from: "a@b.c",
      to: "d@e.f",
      fetchImplementation: async () =>
        new Response('{"message":"domain not verified"}', { status: 403 }),
    });

    expect(notifier.send(payload())).rejects.toThrow("domain not verified");
  });
});
