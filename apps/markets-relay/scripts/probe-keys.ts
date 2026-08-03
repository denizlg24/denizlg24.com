#!/usr/bin/env bun
/**
 * Asks Tiingo what it thinks of each configured key, one at a time.
 *
 * The relay multiplexes every browser onto a single upstream and rotates keys
 * on rejection, which is the right behaviour and also the reason a bad key is
 * invisible: the socket just never reaches "connected". This opens one socket
 * per key, in isolation, and prints the verdict.
 *
 *   bun --env-file=.env.markets scripts/probe-keys.ts
 *   bun --env-file=../../.env scripts/probe-keys.ts AAPL
 */

import { THRESHOLD_LEVEL } from "../src/tiingo-socket";

const TIINGO_IEX_URL = "wss://api.tiingo.com/iex";
const TIMEOUT_MS = 15_000;

function readApiKeys(): string[] {
  const keys: string[] = [];
  const first = process.env.TIINGO_API_KEY?.trim();
  if (first) keys.push(first);
  for (let index = 2; ; index++) {
    const key = process.env[`TIINGO_API_KEY_${index}`]?.trim();
    if (!key) break;
    keys.push(key);
  }
  return keys;
}

/** Enough to identify which key is which without putting one in a log. */
function fingerprint(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

interface Verdict {
  outcome: "accepted" | "rejected" | "closed" | "timeout" | "error";
  detail: string;
  firstQuoteMs: number | null;
}

function probe(key: string, tickers: string[]): Promise<Verdict> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let subscribed = false;

    const socket = new WebSocket(TIINGO_IEX_URL);

    const finish = (verdict: Verdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closing; the verdict is what matters.
      }
      resolve(verdict);
    };

    const timer = setTimeout(() => {
      finish({
        // A subscribe Tiingo neither answers nor refuses is still a failure,
        // but a different one from a rejected key.
        outcome: subscribed ? "timeout" : "error",
        detail: subscribed
          ? "subscribed, but no response within the window"
          : "no connection within the window",
        firstQuoteMs: null,
      });
    }, TIMEOUT_MS);

    socket.addEventListener("open", () => {
      subscribed = true;
      socket.send(
        JSON.stringify({
          eventName: "subscribe",
          authorization: key,
          eventData: { thresholdLevel: THRESHOLD_LEVEL, tickers },
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const message = parsed as {
        messageType?: string;
        response?: { code?: number; message?: string };
      };

      if (message.messageType === "I" || message.messageType === "E") {
        const code = message.response?.code ?? 0;
        const detail = `${code} ${message.response?.message ?? ""}`.trim();
        if (code !== 200) {
          finish({ outcome: "rejected", detail, firstQuoteMs: null });
          return;
        }
        console.log(`    subscribed: ${detail}`);
        return;
      }

      if (message.messageType === "A") {
        finish({
          outcome: "accepted",
          detail: "receiving data",
          firstQuoteMs: Date.now() - started,
        });
      }
    });

    socket.addEventListener("close", (event) => {
      const { code, reason } = event as CloseEvent;
      finish({
        outcome: "closed",
        detail: `closed ${code}${reason ? ` ${reason}` : ""}`,
        firstQuoteMs: null,
      });
    });

    socket.addEventListener("error", () => {
      finish({ outcome: "error", detail: "socket error", firstQuoteMs: null });
    });
  });
}

const tickers = process.argv.slice(2);
const symbols = tickers.length > 0 ? tickers : ["AAPL", "MSFT"];
const keys = readApiKeys();

if (keys.length === 0) {
  console.error("No TIINGO_API_KEY set. Pass --env-file, or export one.");
  process.exit(1);
}

console.log(`Probing ${keys.length} key(s) against ${symbols.join(", ")}\n`);

let accepted = 0;
for (const [index, key] of keys.entries()) {
  const label = `key ${index + 1} (${fingerprint(key)})`;
  console.log(`  ${label}`);
  const verdict = await probe(key, symbols);
  const timing =
    verdict.firstQuoteMs === null ? "" : ` after ${verdict.firstQuoteMs}ms`;
  console.log(`    → ${verdict.outcome}: ${verdict.detail}${timing}\n`);
  if (verdict.outcome === "accepted") accepted++;
}

// "timeout" outside market hours is expected and not a failure: the feed is
// simply silent, which is exactly what the relay's heartbeat exists to survive.
console.log(`${accepted}/${keys.length} key(s) delivered data.`);
if (accepted === 0) {
  console.log(
    "No key delivered data. Outside US market hours a silent-but-subscribed",
  );
  console.log(
    "socket is normal — check that the subscribe response above was 200.",
  );
}
