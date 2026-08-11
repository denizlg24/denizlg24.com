"use client";

import { formatRelative } from "@repo/cloud-ui/format";
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
import { Copy, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { ResourceKindBadge, ScopeBadge } from "@/components/resource-badges";
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
      >
        <ResourceKindBadge kind={resource.kind} />
      </PageHeading>

      <Section title="credentials">
        <Credentials resourceId={resource.id} />
      </Section>

      <Section title="connected projects" count={resource.connections.length}>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {resource.connections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>
                    {connection.targetId ? (
                      <Link
                        href={`/${encodeURIComponent(connection.projectSlug)}/storage`}
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
                    <ScopeBadge scopes={connection.scopes} />
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {connection.envPrefix ? `${connection.envPrefix}_` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatRelative(connection.createdAt)}
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
