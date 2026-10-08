import { redirect } from "next/navigation";

import { RefreshButton } from "@/components/refresh-button";
import type { ApiFailure } from "@/lib/macros-api";
import { FORBIDDEN_PATH } from "@/lib/session";

function headline(status: number): string {
  if (status === 0) return "Macros API unreachable";
  if (status === 401) return "Token refused by the Macros API";
  if (status === 503) return "Sign-in unavailable";
  if (status >= 500) return "Macros API error";
  return "Request failed";
}

export function ApiFailureView({ failure }: { failure: ApiFailure }) {
  if (failure.status === 403) redirect(FORBIDDEN_PATH);
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-accent-strong">
          {headline(failure.status)}
        </p>
        <p className="font-mono text-xs break-all text-muted-foreground">
          {failure.status || "network"} · {failure.error}
        </p>
      </div>
      <RefreshButton />
    </div>
  );
}
