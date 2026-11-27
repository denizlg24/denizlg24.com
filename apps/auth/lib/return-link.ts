"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { accountApi } from "@/lib/tenants-api";

/**
 * An app that sends someone here to manage their account opens
 * `/account` or `/security` with `client_id` and `returnTo`. The API confirms
 * `returnTo` sits on an origin that client registered a redirect on; only then
 * is the link drawn, and it is kept for the tab so moving between the account
 * pages keeps it.
 */
const returnLinkSchema = z.object({
  clientId: z.string(),
  url: z.url(),
  name: z.string(),
  logoUrl: z.string().nullable(),
});
export type ReturnLink = z.infer<typeof returnLinkSchema>;

const STORAGE_KEY = "deniz-auth.return-link";

function stored(): ReturnLink | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = returnLinkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function remember(link: ReturnLink | null) {
  try {
    if (link) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(link));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode); the link then lasts the page.
  }
}

export function useReturnLink(): ReturnLink | null {
  const [link, setLink] = useState<ReturnLink | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get("client_id");
    const returnTo = params.get("returnTo");
    if (!clientId || !returnTo) {
      setLink(stored());
      return;
    }
    let active = true;
    accountApi
      .returnLink(clientId, returnTo)
      .then((confirmed) => {
        const next: ReturnLink = {
          clientId,
          url: confirmed.url,
          name: confirmed.tenant.name,
          logoUrl: confirmed.tenant.logoUrl,
        };
        remember(next);
        if (active) setLink(next);
      })
      .catch(() => {
        // A link that does not check out replaces nothing it could vouch for.
        remember(null);
        if (active) setLink(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return link;
}
