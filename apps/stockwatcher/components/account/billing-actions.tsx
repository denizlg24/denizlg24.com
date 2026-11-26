"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

async function redirectFrom(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !data.url)
    throw new Error(data.error ?? "Something went wrong. Try again.");
  window.location.assign(data.url);
}

function useRedirect() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const run = async (path: string, body?: unknown) => {
    setWorking(true);
    setError("");
    try {
      await redirectFrom(path, body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setWorking(false);
    }
  };
  return { working, error, run };
}

export function BuyButton({ productId }: { productId: string }) {
  const { working, error, run } = useRedirect();
  return (
    <span className="billing-action">
      <Button
        size="xs"
        disabled={working}
        onClick={() => run("/api/billing/checkout", { productId })}
      >
        {working ? "Opening…" : "Buy"}
      </Button>
      {error ? (
        <span className="billing-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function PortalButton() {
  const { working, error, run } = useRedirect();
  return (
    <span className="billing-action">
      <Button
        size="sm"
        variant="outline"
        disabled={working}
        onClick={() => run("/api/billing/portal")}
      >
        {working ? "Opening…" : "Receipts and billing"}
      </Button>
      {error ? (
        <span className="billing-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
