"use client";

import { AuthShell } from "@repo/cloud-ui/auth-shell";
import { Button } from "@repo/ui/button";
import { useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { api, errorMessage, type PublicClient } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { isProviderRedirect } from "@/lib/authorization";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 border-b py-2 text-xs last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all">{children}</span>
    </div>
  );
}

function ConsentForm() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const scopes = (searchParams.get("scope") ?? "").split(" ").filter(Boolean);
  const resources = searchParams.getAll("resource");

  const [client, setClient] = useState<PublicClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    void api
      .publicClient(clientId)
      .then((found) => {
        if (active) setClient(found);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  const decide = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    const { data, error: consentError } = await authClient.oauth2.consent({
      accept,
    });
    if (consentError) {
      setBusy(false);
      setError(consentError.message ?? "Consent failed");
      return;
    }
    // The client plugin follows the redirect itself; stay disabled until the
    // browser leaves.
    if (!isProviderRedirect(data)) setBusy(false);
  };

  if (!clientId) {
    return (
      <AuthShell title="Authorize" error="Missing authorization request">
        {null}
      </AuthShell>
    );
  }

  let redirectLabel = redirectUri ?? "—";
  if (redirectUri) {
    try {
      const url = new URL(redirectUri);
      redirectLabel = `${url.host}${url.pathname}`;
    } catch {
      redirectLabel = redirectUri;
    }
  }

  return (
    <AuthShell title="Authorize" error={error}>
      <div className="flex flex-col gap-6">
        <div>
          <Row label="client">{client?.client_name ?? "—"}</Row>
          <Row label="client id">
            <span className="font-mono">{clientId}</span>
          </Row>
          <Row label="redirect">
            <span className="font-mono">{redirectLabel}</span>
          </Row>
          <Row label="resource">
            {resources.length > 0 ? (
              <span className="font-mono">{resources.join(" ")}</span>
            ) : (
              "—"
            )}
          </Row>
          <Row label="scope">
            {scopes.length > 0 ? (
              <span className="font-mono">{scopes.join(" ")}</span>
            ) : (
              "—"
            )}
          </Row>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1"
            disabled={busy || !client}
            onClick={() => void decide(true)}
          >
            Allow
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => void decide(false)}
          >
            Deny
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={null}>
      <ConsentForm />
    </Suspense>
  );
}
