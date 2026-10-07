"use client";

import { FlowFrame } from "@repo/auth-ui/flow-frame";
import { FlowMessage } from "@repo/auth-ui/status-step";
import { errorMessage, isApiError } from "@repo/cloud-ui/api-error";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import type { AccountSummary } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { accountApi } from "@/lib/tenants-api";
import { loginHref } from "./session-gate";
import { PageIntro, PageSkeleton, ShellFrame } from "./shell-frame";

interface AccountContextValue {
  account: AccountSummary;
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

function useAccountContext(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount outside AccountGate");
  return value;
}

export function useAccount(): AccountSummary {
  return useAccountContext().account;
}

/** Re-reads the account, e.g. after leaving an app changes the navigation. */
export function useRefreshAccount(): () => Promise<void> {
  return useAccountContext().refresh;
}

type GateState =
  | { status: "checking" }
  | { status: "ready"; account: AccountSummary }
  | { status: "inactive"; message: string }
  | { status: "failed"; message: string };

/**
 * Lets in every deniz account — the owner, family and anyone who signed up
 * through an app — where `SessionGate` lets in only the owner. Signed out, the
 * browser goes to sign-in and comes back here.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "checking" });

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const account = await accountApi.summary();
      setState({ status: "ready", account });
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        window.location.replace(loginHref(window.location.href));
        return false;
      }
      setState(
        isApiError(error) && error.status === 403
          ? { status: "inactive", message: errorMessage(error) }
          : { status: "failed", message: errorMessage(error) },
      );
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  if (state.status === "inactive") {
    return (
      <FlowFrame themeToggle={<ThemeToggle />}>
        <FlowMessage
          title="This account is switched off"
          detail={`${state.message}. Sign out, then sign in with another account.`}
          action={
            <Button asChild size="lg" className="h-11 w-full text-base">
              <a href="/logout">Sign out</a>
            </Button>
          }
        />
      </FlowFrame>
    );
  }
  if (state.status === "failed") {
    return (
      <ShellFrame user={null}>
        <PageIntro
          title="Couldn't load your account"
          description="Nothing has changed. Try again in a moment."
        />
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
        <div>
          <Button
            variant="outline"
            onClick={() => {
              setState({ status: "checking" });
              void load();
            }}
          >
            Try again
          </Button>
        </div>
      </ShellFrame>
    );
  }
  if (state.status === "checking") {
    return (
      <ShellFrame user={null}>
        <PageSkeleton />
      </ShellFrame>
    );
  }
  return (
    <AccountContext.Provider value={{ account: state.account, refresh }}>
      {children}
    </AccountContext.Provider>
  );
}

function SignedInAccountShell({ children }: { children: ReactNode }) {
  const account = useAccount();
  return <ShellFrame user={account}>{children}</ShellFrame>;
}

/** The management shell for pages every account may open. */
export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <AccountGate>
      <SignedInAccountShell>{children}</SignedInAccountShell>
    </AccountGate>
  );
}
