"use client";

import { useEffect, useRef, useState } from "react";
import {
  closeSignal,
  createPeer,
  readSignal,
  ShareExpired,
  sendDescription,
  waitForSignal,
} from "./connection";

const button =
  "rounded-full border border-paper/30 px-5 py-2 text-sm font-semibold";

export function ScreenReceiver({
  receiverKey,
  onExit,
  onStatus,
}: {
  receiverKey: string;
  onExit?: () => void;
  onStatus?: (status: "playing" | "ended") => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const started = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [code, setCode] = useState<string>();
  const [live, setLive] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [message, setMessage] = useState("Getting your TV code…");

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, []);

  useEffect(() => {
    clearTimeout(closing.current);
    const controller = new AbortController();
    const { signal } = controller;
    const stop = () => {
      controller.abort();
      closeSignal(receiverKey);
      if (video.current) video.current.srcObject = null;
    };
    const end = (text: string) => {
      stop();
      started.current = false;
      setCode(undefined);
      setLive(false);
      setNeedsPlay(false);
      setMessage(text);
      onStatus?.("ended");
    };
    const ended = () => end("Screen sharing ended.");
    const connect = async () => {
      const pair = await readSignal(receiverKey, signal, true);
      setCode(pair.code);
      setMessage(
        "On your computer, open Screen Share in Stream and enter this code.",
      );
      const offer = pair.offer
        ? { type: "offer" as const, sdp: pair.offer }
        : await waitForSignal(receiverKey, "offer", signal);
      setCode(undefined);
      setMessage("Connecting to your computer…");
      const peer = createPeer(
        pair.iceServers,
        signal,
        () => {},
        () => {
          end("The connection was lost. Open Screen Share again to retry.");
        },
      );
      peer.ondatachannel = ({ channel }) => {
        channel.onclose = () => {
          if (!signal.aborted) ended();
        };
        channel.onmessage = (event) => {
          if (event.data === "stop" && !signal.aborted) ended();
        };
      };
      peer.ontrack = ({ streams }) => {
        const surface = video.current;
        if (!surface || !streams[0] || surface.srcObject === streams[0]) return;
        surface.srcObject = streams[0];
        void surface.play().catch((error: unknown) => {
          if (
            !signal.aborted &&
            error instanceof DOMException &&
            error.name === "NotAllowedError"
          ) {
            setNeedsPlay(true);
          }
        });
      };
      await peer.setRemoteDescription(offer);
      await sendDescription(receiverKey, peer, "answer", signal);
    };

    void connect().catch((error) => {
      if (signal.aborted) return;
      end(
        error instanceof ShareExpired
          ? "This code expired or sharing ended. Open Screen Share again for a new code."
          : "Screen sharing couldn’t connect. Open Screen Share again to retry.",
      );
    });
    const surface = video.current;
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      controller.abort();
      if (surface) surface.srcObject = null;
      // A development effect replay reuses this receiver.
      closing.current = setTimeout(() => closeSignal(receiverKey), 0);
    };
  }, [receiverKey, onStatus]);

  const showVideo = () => {
    if (started.current || !video.current?.videoWidth || video.current.paused)
      return;
    started.current = true;
    setNeedsPlay(false);
    setLive(true);
    onStatus?.("playing");
  };

  const className =
    "fixed inset-0 z-50 grid size-full max-h-none max-w-none place-items-center bg-ink text-paper";
  const contents = (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: The live source supplies its own picture and optional audio. */}
      <video
        ref={video}
        autoPlay
        playsInline
        onPlaying={showVideo}
        onTimeUpdate={showVideo}
        className={`absolute inset-0 size-full bg-black object-contain ${live ? "" : "invisible"}`}
      />
      {!live || needsPlay ? (
        <div className="relative grid max-w-2xl justify-items-center gap-5 px-12 text-center">
          <h1 className="text-4xl font-bold">Screen Share</h1>
          {code ? (
            <p
              className="text-6xl font-bold tracking-widest text-amber"
              data-pairing-code
            >
              <span aria-hidden="true">
                {code.slice(0, 4)}-{code.slice(4)}
              </span>
              <span className="sr-only">{code.split("").join(" ")}</span>
            </p>
          ) : null}
          <p aria-live="polite" className="text-xl text-paper/75">
            {message}
          </p>
          {needsPlay ? (
            <button
              type="button"
              data-nav
              className={button}
              onClick={() =>
                void video.current
                  ?.play()
                  .then(() => setNeedsPlay(false))
                  .catch(() => {})
              }
            >
              Play screen share
            </button>
          ) : null}
          {!onExit ? (
            <p className="text-sm text-paper/60">Press Back to leave.</p>
          ) : null}
        </div>
      ) : null}
      {onExit ? (
        <button
          type="button"
          data-nav
          onClick={onExit}
          className={`${button} absolute right-6 top-6 bg-ink/80`}
        >
          Exit Screen Share
        </button>
      ) : null}
    </>
  );
  return onExit ? (
    <dialog
      ref={dialog}
      aria-label="Screen Share"
      className={className}
      onCancel={(event) => {
        event.preventDefault();
        onExit();
      }}
    >
      {contents}
    </dialog>
  ) : (
    <section className={className}>{contents}</section>
  );
}
