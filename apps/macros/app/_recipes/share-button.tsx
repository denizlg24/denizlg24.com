"use client";

import { Share2, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import styles from "./share.module.css";

export function ShareButton({
  title,
  url,
  className,
}: {
  title: string;
  url: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [notice, setNotice] = useState("");
  const absoluteUrl = () => new URL(url, window.location.origin).href;
  const [shareUrl, setShareUrl] = useState(url);
  const platforms = [
    [
      "WhatsApp",
      `https://wa.me/?text=${encodeURIComponent(`${title} ${shareUrl}`)}`,
    ],
    [
      "Facebook",
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    ],
    [
      "X",
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(shareUrl)}`,
    ],
    [
      "Reddit",
      `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(title)}`,
    ],
  ];
  return (
    <>
      <button
        type="button"
        className={className ?? styles.trigger}
        aria-label="Share recipe"
        onClick={() => {
          setShareUrl(absoluteUrl());
          setNotice("");
          dialog.current?.showModal();
        }}
      >
        <Share2 size={18} aria-hidden="true" />
        <span>Share</span>
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={headingId}
      >
        <div className={styles.header}>
          <h2 id={headingId}>Share recipe</h2>
          <button
            type="button"
            aria-label="Close share dialog"
            className={styles.close}
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p className={styles.title}>{title}</p>
        <div className={styles.platforms}>
          {platforms.map(([name, href]) => (
            <a key={name} href={href} target="_blank" rel="noopener noreferrer">
              {name}
            </a>
          ))}
        </div>
        <label className={styles.link}>
          Recipe link
          <input
            readOnly
            value={shareUrl}
            onFocus={(event) => event.target.select()}
          />
        </label>
        <div className={styles.controls}>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(absoluteUrl());
                setNotice("Link copied.");
              } catch {
                setNotice("Select the recipe link above and copy it.");
              }
            }}
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!navigator.share) {
                setNotice("Choose a platform above or copy the link.");
                return;
              }
              try {
                await navigator.share({ title, url: absoluteUrl() });
              } catch (error) {
                if (!(error instanceof Error && error.name === "AbortError"))
                  setNotice("Couldn’t open sharing. Copy the link instead.");
              }
            }}
          >
            More options
          </button>
        </div>
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      </dialog>
    </>
  );
}
