"use client";

import { Button } from "@repo/ui/button";
import { LoaderCircle } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  startTransition,
  useActionState,
  useContext,
  useOptimistic,
  useRef,
} from "react";
import { adminAction } from "@/app/admin/actions";
import {
  type AdminChange,
  type AdminResult,
  optimisticOrder,
  pendingMessage,
} from "@/lib/admin-feedback";

const empty: AdminChange[] = [];
const Changes = createContext<{
  changes: AdminChange[];
  add: (change: AdminChange) => void;
}>({ changes: empty, add: () => {} });
const Pending = createContext<{ pending: boolean; label: string }>({
  pending: false,
  label: "Saving…",
});

export function AdminFeedback({ children }: { children: ReactNode }) {
  const [changes, add] = useOptimistic(
    empty,
    (previous, change: AdminChange) => [
      ...previous.filter((item) => item.id !== change.id),
      change,
    ],
  );
  return (
    <Changes.Provider value={{ changes, add }}>{children}</Changes.Provider>
  );
}

export function useAdminChange(id?: string) {
  return useContext(Changes).changes.find((change) => !!id && change.id === id);
}

export function AdminForm({
  children,
  className,
  compact = false,
  targetId,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  targetId?: string;
}) {
  const { add, changes } = useContext(Changes);
  const locked = useRef(false);
  const attempt = useRef<string | null>(null);
  const submitted = useRef<AdminChange | null>(null);
  const [result, dispatch, pending] = useActionState(
    async (_: AdminResult | null, data: FormData) => {
      const fields = Object.fromEntries(
        Array.from(data.entries()).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      const change = {
        operation: fields.operation ?? "",
        id: fields.id ?? "",
        fields,
      };
      submitted.current = change;
      add(change);
      try {
        const result = await adminAction(data);
        attempt.current = null;
        return result;
      } catch {
        // Keep the same id on an ambiguous network failure. Retrying must not
        // duplicate a command that might already have reached the server.
        return {
          ok: false,
          message:
            "The response was interrupted. Your input is kept. Check the audit log before retrying.",
        };
      } finally {
        locked.current = false;
      }
    },
    null,
  );
  const otherChange = changes.find(
    (change) => targetId && change.id === targetId,
  );
  const busy = pending || !!otherChange;
  const label = otherChange
    ? pendingMessage(otherChange)
    : submitted.current
      ? pendingMessage(submitted.current)
      : "Saving…";
  return (
    <Pending.Provider value={{ pending: busy, label }}>
      <form
        className={className}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (locked.current || busy) return;
          locked.current = true;
          const data = new FormData(event.currentTarget);
          attempt.current ??= crypto.randomUUID();
          data.set("mutationId", attempt.current);
          startTransition(() => dispatch(data));
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {children}
        </fieldset>
        {!compact || result?.ok === false ? (
          <p
            role={result?.ok === false && !pending ? "alert" : "status"}
            aria-live="polite"
            className={`mt-2 text-xs ${result?.ok === false && !pending ? "text-destructive" : "text-muted-foreground"}`}
          >
            {pending ? label : result?.message}
          </p>
        ) : null}
      </form>
    </Pending.Provider>
  );
}

export function ActionButton({
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button>) {
  const { pending, label } = useContext(Pending);
  const iconOnly = props.size?.startsWith("icon");
  return (
    <Button
      {...props}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <LoaderCircle
            aria-hidden
            className="size-3.5 motion-safe:animate-spin"
          />
          <span className={iconOnly ? "sr-only" : undefined}>{label}</span>
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export function OptimisticServiceOrder({
  entries,
}: {
  entries: { id: string; content: ReactNode }[];
}) {
  const { changes } = useContext(Changes);
  const byId = new Map(entries.map((entry) => [entry.id, entry.content]));
  return (
    <div>
      {optimisticOrder(
        entries.map((entry) => entry.id),
        changes,
      ).map((id) => (
        <div key={id}>{byId.get(id)}</div>
      ))}
    </div>
  );
}

export function PendingNewItem({ kind }: { kind: "incident" | "maintenance" }) {
  const { changes } = useContext(Changes);
  return changes
    .filter(
      (change) =>
        !change.id &&
        (kind === "incident"
          ? change.operation === "incident-create"
          : change.operation === "maintenance-save"),
    )
    .map((change) => (
      <article
        key={change.operation}
        className="border-b py-4"
        aria-busy="true"
      >
        <h3 className="text-sm font-medium">{change.fields.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {change.fields.text ?? change.fields.description}
        </p>
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {pendingMessage(change)}
        </p>
      </article>
    ));
}
