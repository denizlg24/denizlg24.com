const SIGNAL_URL = "/api/public/screen-share";
const POLL_MS = 1_000;

export class ShareExpired extends Error {}

interface SignalOptions extends RequestInit {
  ice?: boolean;
}

async function signalRequest(
  key: string,
  { ice, ...options }: SignalOptions = {},
) {
  const response = await fetch(ice ? `${SIGNAL_URL}?ice` : SIGNAL_URL, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: `Cast ${key}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (response.status === 404) throw new ShareExpired();
  if (!response.ok) throw new Error("Screen sharing request failed");
  return response;
}

export async function readSignal(
  key: string,
  signal: AbortSignal,
  ice = false,
) {
  return (await (await signalRequest(key, { signal, ice })).json()) as {
    code?: string;
    offer?: string | null;
    answer?: string | null;
    iceServers?: RTCIceServer[];
  };
}

export function closeSignal(key: string) {
  void signalRequest(key, { method: "DELETE", keepalive: true }).catch(
    () => {},
  );
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}

export async function waitForSignal(
  key: string,
  type: "offer" | "answer",
  signal: AbortSignal,
): Promise<RTCSessionDescriptionInit> {
  while (true) {
    const value = (await readSignal(key, signal))[type];
    if (value) return { type, sdp: value };
    await pause(POLL_MS, signal);
  }
}

export function createPeer(
  iceServers: RTCIceServer[] | undefined,
  signal: AbortSignal,
  onConnected: () => void,
  onLost: () => void,
) {
  signal.throwIfAborted();
  const peer = new RTCPeerConnection({ iceServers });
  let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(
    onLost,
    45_000,
  );
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timeout);
      peer.onconnectionstatechange = null;
      peer.close();
    },
    { once: true },
  );
  peer.onconnectionstatechange = () => {
    clearTimeout(timeout);
    switch (peer.connectionState) {
      case "connected":
        onConnected();
        break;
      case "disconnected":
        timeout = setTimeout(onLost, 8_000);
        break;
      case "failed":
      case "closed":
        onLost();
        break;
      default:
        timeout = setTimeout(onLost, 45_000);
    }
  };
  return peer;
}

export async function sendDescription(
  key: string,
  peer: RTCPeerConnection,
  type: "offer" | "answer",
  signal: AbortSignal,
) {
  const description =
    type === "offer" ? await peer.createOffer() : await peer.createAnswer();
  await peer.setLocalDescription(description);
  // Include candidates in the description to publish the offer and answer in one request each.
  // The timeout covers networks that drop STUN/TURN packets.
  if (peer.iceGatheringState !== "complete") {
    await new Promise<void>((resolve, reject) => {
      function finish(error?: unknown) {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", gathered);
        signal.removeEventListener("abort", cancel);
        if (error) reject(error);
        else resolve();
      }
      function cancel() {
        finish(signal.reason);
      }
      function gathered() {
        if (peer.iceGatheringState === "complete") finish();
      }
      const timer = setTimeout(finish, 6_000);
      peer.addEventListener("icegatheringstatechange", gathered);
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    });
  }
  await signalRequest(key, {
    method: "PUT",
    body: JSON.stringify(peer.localDescription),
    signal,
  });
}
