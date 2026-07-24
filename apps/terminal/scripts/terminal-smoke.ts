import { terminalTicketResponseSchema } from "@repo/schemas/cloud";

const apiUrl = new URL(process.env.TERMINAL_API_URL ?? "http://127.0.0.1:3010");
function requiredSessionCookie(): string {
  const value = process.env.TERMINAL_COOKIE;
  if (!value) {
    throw new Error("TERMINAL_COOKIE must contain a superuser session cookie");
  }
  return value;
}
const sessionCookie = requiredSessionCookie();

async function mint(sessionId?: string) {
  const response = await fetch(new URL("/api/ops/terminal", apiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) {
    throw new Error(`Ticket mint failed with ${response.status}`);
  }
  return terminalTicketResponseSchema.parse(await response.json()).data;
}

async function connect(ticket: string): Promise<WebSocket> {
  const url = new URL("/api/ops/terminal/ws", apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WS failed")), {
      once: true,
    });
  });
  return socket;
}

function waitForMarker(socket: WebSocket, marker: string): Promise<number> {
  const decoder = new TextDecoder();
  let bytes = 0;
  let tail = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${marker}`)),
      30_000,
    );
    socket.addEventListener("message", (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      bytes += event.data.byteLength;
      tail = `${tail}${decoder.decode(event.data, { stream: true })}`.slice(
        -1_024,
      );
      if (tail.includes(marker)) {
        clearTimeout(timeout);
        resolve(bytes);
      }
    });
  });
}

const firstTicket = await mint();
const first = await connect(firstTicket.ticket);
const firstDone = waitForMarker(first, "FLOOD_COMPLETE");
first.send(
  new TextEncoder().encode(
    "export CLOUD_SMOKE_REATTACH=kept; yes | head -c 10000000; printf '\\nFLOOD_COMPLETE\\n'\n",
  ),
);
const bytes = await firstDone;
first.close(1000, "reconnect test");

const secondTicket = await mint(firstTicket.sessionId);
const second = await connect(secondTicket.ticket);
const reattached = waitForMarker(second, "REATTACH:kept");
second.send(
  new TextEncoder().encode(
    "printf 'REATTACH:%s\\n' \"$CLOUD_SMOKE_REATTACH\"\n",
  ),
);
await reattached;
second.close(1000, "smoke complete");
console.log(`Terminal smoke passed (${bytes} bytes before reconnect)`);
