"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { ResourceIcon } from "@repo/cloud-ui/tech-icon";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { ResourceCredentials } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { Copy, Eye, EyeOff, Trash2, Unlink } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { ResourceKindBadge, ScopeBadge } from "@/components/resource-badges";
import { ConnectResourceDialog } from "@/components/resource-dialogs";
import { api, errorMessage } from "@/lib/api";

/** Which fields are worth showing, in the order they read. */
const FIELDS: {
  key: keyof ResourceCredentials;
  label: string;
  secret?: true;
}[] = [
  { key: "url", label: "url", secret: true },
  { key: "host", label: "host" },
  { key: "port", label: "port" },
  { key: "database", label: "database" },
  { key: "bucket", label: "bucket" },
  { key: "username", label: "user" },
  { key: "password", label: "password", secret: true },
  { key: "accessKeyId", label: "access key id" },
  { key: "secretAccessKey", label: "secret access key", secret: true },
  { key: "apiKey", label: "api key", secret: true },
];

export default function ResourceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const fetchResource = useCallback(
    () => api.deploy.resource(params.id),
    [params.id],
  );
  const {
    data: resource,
    error,
    unreachable,
    loading,
    reload,
  } = usePoll(fetchResource, null);

  async function disconnect(resourceId: string, connectionId: string) {
    try {
      await api.deploy.disconnectResource(resourceId, connectionId);
      toast.success("Disconnected");
      await reload();
    } catch (disconnectError) {
      toast.error(errorMessage(disconnectError));
    }
  }

  if (unreachable) {
    return <Unreachable retrying={loading} onRetry={() => void reload()} />;
  }
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!resource) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeading
        title={resource.name}
        detail={`${resource.kind} · ${resource.engine} · created ${formatRelative(resource.createdAt)}`}
        icon={
          <ResourceIcon
            kind={resource.kind}
            className="size-5 text-muted-foreground"
          />
        }
      >
        <ResourceKindBadge kind={resource.kind} />
        {/* Refused server-side while anything is still connected, so the button
            is disabled rather than hidden: "disconnect these four projects
            first" is the next action, and hiding it answers nothing. */}
        <TypedConfirmDialog
          title={`Delete ${resource.name}`}
          keyword={resource.name}
          actionLabel="Delete"
          onConfirm={async () => {
            try {
              await api.deploy.removeResource(resource.id);
              toast.success("Resource deleted");
              router.push("/resources");
            } catch (deleteError) {
              toast.error(errorMessage(deleteError));
            }
          }}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              disabled={resource.connections.length > 0}
            >
              <Trash2 className="size-3" />
            </Button>
          }
        />
      </PageHeading>

      <Section title="credentials">
        <Credentials resourceId={resource.id} />
      </Section>

      <Section
        title="connected projects"
        count={resource.connections.length}
        actions={
          <ConnectResourceDialog
            resourceId={resource.id}
            onConnected={reload}
            trigger={
              <Button variant="outline" size="sm">
                Connect
              </Button>
            }
          />
        }
      >
        {resource.connections.length === 0 ? (
          // Not an empty state to fix. A resource used by an app that deploys
          // on Vercel has nothing here and never will.
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>project</TableHead>
                <TableHead>scope</TableHead>
                <TableHead>prefix</TableHead>
                <TableHead className="text-right">connected</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {resource.connections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>
                    {connection.targetId ? (
                      <Link
                        href={`/${encodeURIComponent(connection.projectSlug)}/resources`}
                        className="text-xs hover:underline"
                      >
                        {connection.projectSlug}
                      </Link>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        title="No deployable — this project exists to hold the resource"
                      >
                        {connection.projectSlug}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ScopeBadge
                      scopes={connection.scopes}
                      environmentName={connection.environmentName}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {connection.envPrefix ? `${connection.envPrefix}_` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatRelative(connection.createdAt)}
                  </TableCell>
                  {/* Disconnecting destroys nothing — it stops this project's
                      bindings resolving through the resource. Dropping the
                      resource itself is the button in the header. */}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Disconnect ${connection.projectSlug}`}
                      onClick={() =>
                        void disconnect(resource.id, connection.id)
                      }
                    >
                      <Unlink className="size-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}

/**
 * Credentials are fetched on the reveal, never with the page. Rendering the
 * detail route must not be a way to leave a password in a response the browser
 * caches or a screen someone walks past.
 */
function Credentials({ resourceId }: { resourceId: string }) {
  const [values, setValues] = useState<ResourceCredentials | null>(null);
  const [pending, setPending] = useState(false);

  const reveal = async () => {
    setPending(true);
    try {
      setValues(await api.deploy.resourceCredentials(resourceId));
    } catch (revealError) {
      toast.error(errorMessage(revealError));
    } finally {
      setPending(false);
    }
  };

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  if (!values) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void reveal()}
      >
        <Eye className="size-3" />
        {pending ? "revealing…" : "reveal"}
      </Button>
    );
  }

  const present = FIELDS.filter((field) => values[field.key] !== null);

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        {present.map((field) => {
          const value = String(values[field.key]);
          return (
            <div key={field.key} className="contents">
              <dt className="text-xs text-muted-foreground">{field.label}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 break-all font-mono text-xs">
                  {value}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={`Copy ${field.label}`}
                  onClick={() => void copy(field.label, value)}
                >
                  <Copy className="size-3" />
                </Button>
              </dd>
            </div>
          );
        })}
      </dl>
      {/* An s3 resource issues a fresh key pair per deployment, so there is no
          stored pair to show — only where the bucket is. */}
      {values.kind === "s3" ? (
        <p className="text-xs text-muted-foreground">
          keys are issued per deployment
        </p>
      ) : null}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setValues(null)}>
          <EyeOff className="size-3" />
          hide
        </Button>
      </div>
    </div>
  );
}
