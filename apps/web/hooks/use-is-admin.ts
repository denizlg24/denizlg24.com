"use client";

import { useEffect, useState } from "react";

// The session cookie is httpOnly, so the browser cannot read it; one probe per
// page load answers for every comment on it.
let probe: Promise<boolean> | null = null;

function isAdmin(): Promise<boolean> {
  probe ??= fetch("/api/admin/session", { cache: "no-store" })
    .then((response) => response.ok)
    .catch(() => false);
  return probe;
}

export function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    void isAdmin().then((value) => {
      if (active) setAdmin(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return admin;
}
