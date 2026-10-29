"use client";

import type {
  IEmail,
  IEmailAccount,
  IEmailAttachment,
  IFullEmail,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { List, ListRow } from "@repo/ui/list";
import { PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { format } from "date-fns";
import { ArrowLeft, Download, File, Forward, Reply } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { EmailIframe } from "./email-iframe";
import { senderLabel } from "./email-list";

export type ComposeDraft = {
  to?: string;
  subject?: string;
  body?: string;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function prefixSubject(prefix: "Re" | "Fwd", subject: string) {
  const pattern = prefix === "Re" ? /^re:/i : /^(fwd?|fw):/i;
  return pattern.test(subject.trim()) ? subject : `${prefix}: ${subject}`;
}

function forwardBody(email: IEmail, full: IFullEmail | null) {
  const from = email.from
    .map((entry) =>
      entry.name ? `${entry.name} <${entry.address}>` : entry.address,
    )
    .join(", ");
  return [
    "",
    "",
    "---------- Forwarded message ---------",
    `From: ${from}`,
    `Date: ${format(new Date(email.date), "EEE, MMM d, yyyy 'at' HH:mm")}`,
    `Subject: ${email.subject}`,
    "",
    full?.textBody ?? "",
  ].join("\n");
}

export function EmailBody({
  loading,
  html,
  text,
}: {
  loading: boolean;
  html?: string;
  text?: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }
  if (html) return <EmailIframe html={html} />;
  if (text) {
    return (
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-accent-strong">
        {text}
      </pre>
    );
  }
  return <p className="text-sm text-muted-foreground">—</p>;
}

interface EmailDetailProps {
  email: IEmail;
  account: IEmailAccount | undefined;
  onBack: () => void;
  onCompose: (draft?: ComposeDraft) => void;
  emailCache: React.RefObject<Map<string, IFullEmail>>;
  attachmentCache: React.RefObject<Map<string, IEmailAttachment[]>>;
}

export function EmailDetail({
  email,
  account,
  onBack,
  onCompose,
  emailCache,
  attachmentCache,
}: EmailDetailProps) {
  const { client, platform } = useAdmin();
  const accountId = email.accountId;
  const [fullEmail, setFullEmail] = useState<IFullEmail | null>(
    () => emailCache.current.get(email._id) ?? null,
  );
  const [attachments, setAttachments] = useState<IEmailAttachment[]>(
    () => attachmentCache.current.get(email._id) ?? [],
  );
  const [loadingContent, setLoadingContent] = useState(
    () => !emailCache.current.has(email._id),
  );
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cachedEmail = emailCache.current.get(email._id);
    setFullEmail(cachedEmail ?? null);
    setLoadingContent(!cachedEmail);
    if (!cachedEmail) {
      client
        .get<{ email: IFullEmail }>(
          `email-accounts/${accountId}/emails/${email._id}`,
        )
        .then((result) => {
          emailCache.current.set(email._id, result.email);
          if (!cancelled) setFullEmail(result.email);
        })
        .catch(() => {
          if (!cancelled) toast.error("Failed to load email");
        })
        .finally(() => {
          if (!cancelled) setLoadingContent(false);
        });
    }

    const cachedAttachments = attachmentCache.current.get(email._id);
    setAttachments(cachedAttachments ?? []);
    if (!cachedAttachments) {
      client
        .get<{ attachments: IEmailAttachment[] }>(
          `email-accounts/${accountId}/emails/${email._id}/attachments`,
        )
        .then((result) => {
          attachmentCache.current.set(email._id, result.attachments);
          if (!cancelled) setAttachments(result.attachments);
        })
        .catch(() => {
          // attachments are optional
        });
    }

    return () => {
      cancelled = true;
    };
  }, [client, accountId, email._id, emailCache, attachmentCache]);

  const handleDownload = async (attachment: IEmailAttachment) => {
    setDownloadingIdx(attachment.index);
    try {
      const result = await client.raw(
        `email-accounts/${accountId}/emails/${email._id}/attachments?download=${attachment.index}`,
      );
      const buffer = await result.arrayBuffer();
      await platform.downloadFile(attachment.filename, new Blob([buffer]));
      toast.success(`Saved ${attachment.filename}`);
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloadingIdx(null);
    }
  };

  const sender = email.from[0];
  const subject = email.subject || "(No subject)";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={!sender}
          onClick={() =>
            onCompose({
              to: sender?.address,
              subject: prefixSubject("Re", email.subject),
            })
          }
        >
          <Reply />
          Reply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onCompose({
              subject: prefixSubject("Fwd", email.subject),
              body: forwardBody(email, fullEmail),
            })
          }
        >
          <Forward />
          Forward
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6 sm:px-8">
          <PageTitle
            title={subject}
            meta={
              <span className="tabular-nums">
                {format(new Date(email.date), "EEE, MMM d, yyyy 'at' HH:mm")}
              </span>
            }
          />

          <Properties>
            <Property label="From">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate">{senderLabel(email)}</span>
                {sender?.name ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {sender.address}
                  </span>
                ) : null}
              </span>
            </Property>
            {account ? (
              <Property label="Account">
                <span className="truncate">
                  {account.displayName || account.user}
                </span>
              </Property>
            ) : null}
          </Properties>

          <EmailBody
            loading={loadingContent}
            html={fullEmail?.htmlBody}
            text={fullEmail?.textBody}
          />

          {attachments.length > 0 ? (
            <Section title="Attachments" count={attachments.length}>
              <List>
                {attachments.map((attachment) => (
                  <ListRow
                    key={attachment.index}
                    leading={<File />}
                    title={attachment.filename}
                    meta={formatFileSize(attachment.size)}
                    onClick={
                      downloadingIdx === attachment.index
                        ? undefined
                        : () => void handleDownload(attachment)
                    }
                    trailing={
                      downloadingIdx === attachment.index ? (
                        <Spinner className="size-3.5 text-muted-foreground" />
                      ) : (
                        <Download className="size-3.5 text-muted-foreground" />
                      )
                    }
                  />
                ))}
              </List>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
