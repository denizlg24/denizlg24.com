"use client";

import { useState } from "react";
import styles from "./article.module.css";

export function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button type="button" className={styles.textButton} onClick={share}>
      <span aria-live="polite">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}
