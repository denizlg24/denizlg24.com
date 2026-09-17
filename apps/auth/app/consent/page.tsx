"use client";

import {
  type ConsentClient,
  type ConsentItem,
  ConsentStep,
} from "@repo/auth-ui/consent-step";
import { destinationFromClient } from "@repo/auth-ui/destination";
import { FlowFrame } from "@repo/auth-ui/flow-frame";
import { StepAlert, StepHeading } from "@repo/auth-ui/flow-step";
import { CheckingStep } from "@repo/auth-ui/status-step";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import type { OAuthClientList, SafeUser } from "@repo/schemas/cloud";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { loginHref } from "@/components/session-gate";
import { api, errorMessage, isApiError, type PublicClient } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  authorizeUrl,
  isAuthorizationRedirect,
  isProviderRedirect,
} from "@/lib/authorization";

const SCOPE_MEANINGS: Record<string, string> = {
  openid: "Confirm who you are",
  profile: "See your name and username",
  email: "See your email address",
  offline_access: "Stay connected without asking you again",
  superuser: "Act with your full access",
};

function hostAndPath(identifier: string): string {
  try {
    const url = new URL(identifier);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return identifier;
  }
}

function resourceItems(
  identifiers: string[],
  known: OAuthClientList | null,
): ConsentItem[] {
  return identifiers.map((identifier) => {
    const name = known?.resources.find(
      (resource) => resource.identifier === identifier,
    )?.name;
    return name
      ? { label: name, detail: hostAndPath(identifier) }
      : { label: hostAndPath(identifier), detail: null };
  });
}

function scopeItems(scopes: string[]): ConsentItem[] {
  return scopes.map((scope) => {
    const meaning = SCOPE_MEANINGS[scope];
    return meaning
      ? { label: meaning, detail: scope }
      : { label: scope, detail: null };
  });
}

function toConsentClient(
  clientId: string,
  client: PublicClient,
  redirectUri: string | null,
  known: OAuthClientList | null,
): ConsentClient {
  const named = destinationFromClient(clientId, client);
  let homepage = named.host;
  if (!homepage && redirectUri) {
    try {
      homepage = new URL(redirectUri).host;
    } catch {
      homepage = null;
    }
  }
  const registeredItself =
    known?.clients.find((row) => row.clientId === clientId)?.kind === "dynamic";
  return {
    name: named.name,
    logoUri: client.logo_uri ?? null,
    homepage,
    registeredItself,
  };
}

function ConsentFlow() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const scopes = useMemo(
    () => (searchParams.get("scope") ?? "").split(" ").filter(Boolean),
    [searchParams],
  );
  const resources = useMemo(
    () => searchParams.getAll("resource"),
    [searchParams],
  );

  const [client, setClient] = useState<PublicClient | null>(null);
  // Superuser-only context that makes the screen readable: resource names and
  // whether the client registered itself. Consent already refuses anyone
  // else, so a failure here only costs the labels.
  const [known, setKnown] = useState<OAuthClientList | null>(null);
  const [me, setMe] = useState<SafeUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The provider only sends a signed-in browser here, so a 401 means the
  // session ended in between; sign in again and the authorization resumes.
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    void api
      .publicClient(clientId)
      .then((found) => {
        if (active) setClient(found);
      })
      .catch((err) => {
        if (!active) return;
        if (isApiError(err) && err.status === 401) {
          const returnTo = isAuthorizationRedirect(searchParams)
            ? authorizeUrl(searchParams)
            : window.location.href;
          window.location.replace(loginHref(returnTo));
          return;
        }
        setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [clientId, searchParams]);

  useEffect(() => {
    let active = true;
    void api
      .clients()
      .then((list) => {
        if (active) setKnown(list);
      })
      .catch(() => {});
    void api
      .me()
      .then((user) => {
        if (active) setMe(user);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const decide = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    const { data, error: consentError } = await authClient.oauth2.consent({
      accept,
    });
    if (consentError) {
      setBusy(false);
      setError(
        consentError.message ??
          "The answer didn't reach the server. Try again.",
      );
      return;
    }
    // The client plugin follows the redirect itself; stay disabled until the
    // browser leaves.
    if (!isProviderRedirect(data)) setBusy(false);
  };

  if (!clientId) {
    return (
      <FlowFrame themeToggle={<ThemeToggle />}>
        <div className="flex flex-col gap-8">
          <StepHeading>This isn't a valid request</StepHeading>
          <StepAlert>
            No app asked for access. Start again from the app that sent you
            here.
          </StepAlert>
        </div>
      </FlowFrame>
    );
  }

  const consentClient = client
    ? toConsentClient(clientId, client, redirectUri, known)
    : null;
  const switchAccountHref = isAuthorizationRedirect(searchParams)
    ? `/logout?returnTo=${encodeURIComponent(authorizeUrl(searchParams))}`
    : "/logout";

  return (
    <FlowFrame
      destination={
        consentClient
          ? {
              name: consentClient.name,
              host: consentClient.homepage,
              clientId,
            }
          : error
            ? { name: clientId, host: null, clientId }
            : "pending"
      }
      themeToggle={<ThemeToggle />}
    >
      <ConsentStep
        client={consentClient}
        resources={resourceItems(resources, known)}
        scopes={scopeItems(scopes)}
        account={me ? { username: me.username } : null}
        switchAccountHref={switchAccountHref}
        error={error}
        busy={busy}
        onAllow={() => void decide(true)}
        onDeny={() => void decide(false)}
      />
    </FlowFrame>
  );
}

export default function ConsentPage() {
  return (
    <Suspense
      fallback={
        <FlowFrame destination="pending" themeToggle={<ThemeToggle />}>
          <CheckingStep />
        </FlowFrame>
      }
    >
      <ConsentFlow />
    </Suspense>
  );
}
