"use client";

import { MonitorUp } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  closeSignal,
  createPeer,
  readSignal,
  ShareExpired,
  sendDescription,
  waitForSignal,
} from "@/components/screen/connection";
import { ScreenReceiver } from "@/components/screen/receiver";
import {
  addScreenVideo,
  type ScreenVideoFormat,
  screenCaptureOptions,
} from "@/components/screen/video";
import { joinScreenReceiver, openScreenReceiver } from "./actions";

const button =
  "min-h-11 rounded-full px-6 py-2 font-bold transition-colors disabled:opacity-50";
const primary = `${button} bg-paper text-ink enabled:hover:bg-amber`;
const secondary = `${button} border border-paper/30 hover:bg-paper/10`;

type Phase = "idle" | "starting" | "connecting" | "live";

export function ScreenShare({ tv }: { tv: boolean }) {
  const [code, setCode] = useState("");
  const [format, setFormat] = useState<ScreenVideoFormat>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState("");
  const [receiverKey, setReceiverKey] = useState<string>();
  const [opening, setOpening] = useState(false);
  const active = useRef<AbortController>(null);

  useEffect(() => {
    const stop = () => active.current?.abort();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, []);

  async function receive() {
    setNotice("");
    setOpening(true);
    try {
      const share = await openScreenReceiver();
      setReceiverKey(share.receiverKey);
    } catch {
      setNotice("Stream couldn’t get a TV code. Try again.");
    } finally {
      setOpening(false);
    }
  }

  async function share(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || opening) return;
    if (!navigator.mediaDevices?.getDisplayMedia || !window.RTCPeerConnection) {
      setNotice(
        "Open Stream in a desktop browser with screen sharing, such as Chrome.",
      );
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    let capture: MediaStream | undefined;
    let key: string | null = null;
    let channel: RTCDataChannel | undefined;
    const stop = (message: string) => {
      controller.abort();
      if (active.current !== controller) return;
      active.current = null;
      setPhase("idle");
      setNotice(message);
    };
    signal.addEventListener(
      "abort",
      () => {
        if (channel?.readyState === "open") channel.send("stop");
        for (const track of capture?.getTracks() ?? []) track.stop();
        if (key) closeSignal(key);
      },
      { once: true },
    );

    setNotice("");
    setPhase("starting");
    try {
      capture = await navigator.mediaDevices.getDisplayMedia(
        screenCaptureOptions(format),
      );
      if (signal.aborted) {
        for (const track of capture.getTracks()) track.stop();
        return;
      }
      const [video] = capture.getVideoTracks();
      if (!video) throw new Error("Screen capture returned no video");
      video.addEventListener("ended", () => stop("Screen sharing ended."), {
        once: true,
      });
      setPhase("connecting");
      key = await joinScreenReceiver(code);
      if (signal.aborted) {
        if (key) closeSignal(key);
        return;
      }
      if (!key) {
        stop(
          "That TV code has expired, has already been used, or was entered incorrectly.",
        );
        return;
      }
      const config = await readSignal(key, signal, true);
      const peer = createPeer(
        config.iceServers,
        signal,
        () => setPhase("live"),
        () =>
          stop(
            "The connection was lost. Get a new code on the TV and try again.",
          ),
      );
      channel = peer.createDataChannel("screen-share");
      const outgoingVideo = addScreenVideo(peer, video, capture, format);
      for (const track of capture.getAudioTracks())
        peer.addTrack(track, capture);
      await sendDescription(key, peer, "offer", signal);
      const answer = await waitForSignal(key, "answer", signal);
      await peer.setRemoteDescription(answer);
      if (outgoingVideo.currentDirection !== "sendonly") {
        stop(
          "This display couldn’t play the selected format. Get a new TV code and try the other video format.",
        );
      }
    } catch (error) {
      if (signal.aborted) return;
      const message =
        error instanceof ShareExpired
          ? "The TV code is no longer active. Get a new code and try again."
          : !capture &&
              error instanceof DOMException &&
              ["NotAllowedError", "NotReadableError"].includes(error.name)
            ? "Screen sharing wasn’t started. Check your browser and macOS screen recording permissions if needed."
            : "Screen sharing couldn’t connect. Get a new code on the TV and try again.";
      stop(message);
    }
  }

  if (receiverKey) {
    return (
      <ScreenReceiver
        receiverKey={receiverKey}
        onExit={() => setReceiverKey(undefined)}
      />
    );
  }

  return (
    <section className="mx-auto grid max-w-2xl gap-7 px-6 py-12 sm:py-20">
      <div className="grid gap-3">
        <MonitorUp aria-hidden className="size-8 text-amber" />
        <h1 className="text-5xl font-bold">Screen Share</h1>
        <p className="max-w-lg text-lg text-paper/75">
          {tv
            ? "Show a code to share a screen from your computer."
            : "Open Screen Share on your TV, then enter its code to share a screen, window, or tab."}
        </p>
      </div>

      {tv ? (
        <div>
          <button
            type="button"
            data-nav
            data-nav-autofocus
            className={primary}
            disabled={opening}
            onClick={() => void receive()}
          >
            {opening ? "Getting a code…" : "Show TV code"}
          </button>
        </div>
      ) : (
        <>
          <form className="grid max-w-sm gap-3" onSubmit={share}>
            <label htmlFor="screen-code" className="text-sm font-bold">
              TV code
            </label>
            <input
              id="screen-code"
              data-nav
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              disabled={phase !== "idle"}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={13}
              placeholder="ABCD-EFGH"
              required
              className="min-h-12 rounded-lg border border-paper/30 bg-paper/5 px-4 text-lg tracking-widest"
            />
            <label htmlFor="screen-format" className="text-sm font-bold">
              Video format
            </label>
            <select
              id="screen-format"
              data-nav
              data-nav-own="all"
              value={format}
              onChange={(event) =>
                setFormat(
                  event.target.value === "vp8"
                    ? "vp8"
                    : event.target.value === "h264"
                      ? "h264"
                      : "auto",
                )
              }
              disabled={phase !== "idle"}
              className="min-h-11 rounded-lg border border-paper/30 bg-ink px-4 text-paper"
            >
              <option value="auto">Automatic</option>
              <option value="h264">H.264 · TV compatibility</option>
              <option value="vp8">VP8 · Alternate at lower resolution</option>
            </select>
            <div className="flex flex-wrap items-center gap-3">
              <button
                data-nav
                className={primary}
                disabled={
                  opening ||
                  phase !== "idle" ||
                  !/^[A-HJ-NP-Z2-9]{8}$/.test(code.replace(/[-\s]/g, ""))
                }
              >
                Share my screen
              </button>
              {phase !== "idle" ? (
                <button
                  type="button"
                  data-nav
                  className={secondary}
                  onClick={() => {
                    active.current?.abort();
                    active.current = null;
                    setNotice("Screen sharing ended.");
                    setPhase("idle");
                  }}
                >
                  Stop sharing
                </button>
              ) : null}
            </div>
          </form>
          {phase === "idle" ? (
            <button
              type="button"
              data-nav
              className={`${secondary} justify-self-start`}
              disabled={opening}
              onClick={() => void receive()}
            >
              {opening ? "Getting a code…" : "Receive on this screen"}
            </button>
          ) : null}
        </>
      )}
      <p role="status" className="text-sm text-paper/75">
        {phase === "starting" ? "Choose what to share in your browser." : null}
        {phase === "connecting" ? "Connecting to your TV…" : null}
        {phase === "live" ? "Your screen is live on the TV." : null}
        {phase === "idle" ? notice : null}
      </p>
    </section>
  );
}
