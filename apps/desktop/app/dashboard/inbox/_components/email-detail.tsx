"use client";

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { format } from "date-fns";
import {
  ArrowLeft,
  Download,
  File,
  Forward,
  Loader2,
  Paperclip,
  Reply,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { denizApi } from "@/lib/api-wrapper";
import type { IEmail, IEmailAttachment, IFullEmail } from "@/lib/data-types";
import { EmailIframe } from "./email-iframe";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface EmailDetailProps {
  email: IEmail;
  accountId: string;
  api: denizApi;
  onBack: () => void;
  onCompose: (replyTo?: { address: string; subject: string }) => void;
  emailCache: React.RefObject<Map<string, IFullEmail>>;
  attachmentCache: React.RefObject<Map<string, IEmailAttachment[]>>;
}

export function EmailDetail({
  email,
  accountId,
  api,
  onBack,
  onCompose,
  emailCache,
  attachmentCache,
}: EmailDetailProps) {
  const [fullEmail, setFullEmail] = useState<IFullEmail | null>(
    emailCache.current.get(email._id) ?? null,
  );
  const [attachments, setAttachments] = useState<IEmailAttachment[]>(
    attachmentCache.current.get(email._id) ?? [],
  );
  const [loadingContent, setLoadingContent] = useState(!fullEmail);
  const [loadingAttachments, setLoadingAttachments] = useState(
    !attachmentCache.current.has(email._id),
  );
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);

  const fetchContent = useCallback(async () => {
    const cached = emailCache.current.get(email._id);
    if (cached) {
      setFullEmail(cached);
      setLoadingContent(false);
      return;
    }

    setLoadingContent(true);
    const result = await api.GET<{ email: IFullEmail }>({
      endpoint: `email-accounts/${accountId}/emails/${email._id}`,
    });
    if (!("code" in result)) {
      emailCache.current.set(email._id, result.email);
      setFullEmail(result.email);
    } else {
      toast.error("Failed to load email");
    }
    setLoadingContent(false);
  }, [api, accountId, email._id, emailCache]);

  const fetchAttachments = useCallback(async () => {
    const cached = attachmentCache.current.get(email._id);
    if (cached) {
      setAttachments(cached);
      setLoadingAttachments(false);
      return;
    }

    setLoadingAttachments(false);
    const result = await api.GET<{ attachments: IEmailAttachment[] }>({
      endpoint: `email-accounts/${accountId}/emails/${email._id}/attachments`,
    });
    if (!("code" in result)) {
      attachmentCache.current.set(email._id, result.attachments);
      setAttachments(result.attachments);
    }
  }, [api, accountId, email._id, attachmentCache]);

  useEffect(() => {
    fetchContent();
    fetchAttachments();
  }, [fetchContent, fetchAttachments]);

  const handleDownload = async (attachment: IEmailAttachment) => {
    setDownloadingIdx(attachment.index);
    try {
      const result = await api.GET_RAW({
        endpoint: `email-accounts/${accountId}/emails/${email._id}/attachments?download=${attachment.index}`,
      });

      if ("code" in result) {
        toast.error("Failed to download attachment");
        setDownloadingIdx(null);
        return;
      }

      const savePath = await save({
        defaultPath: attachment.filename,
      });

      if (!savePath) {
        setDownloadingIdx(null);
        return;
      }

      const buffer = await result.arrayBuffer();
      await writeFile(savePath, new Uint8Array(buffer));
      toast.success(`Saved ${attachment.filename}`);
    } catch {
      toast.error("Download failed");
    }
    setDownloadingIdx(null);
  };

  const senderName = email.from[0]?.name || email.from[0]?.address || "Unknown";
  const senderAddress = email.from[0]?.address || "";
  const senderInitial = senderName[0]?.toUpperCase() ?? "?";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 py-2.5 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() =>
            onCompose({
              address: senderAddress,
              subject: email.subject,
            })
          }
        >
          <Reply className="h-3.5 w-3.5" />
          Reply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onCompose()}
        >
          <Forward className="h-3.5 w-3.5" />
          Forward
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full mx-auto px-8 py-6">
          <h1 className="text-xl font-semibold leading-snug">
            {email.subject || "(No Subject)"}
          </h1>

          <div className="flex items-center gap-3 mt-5">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
              {senderInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{senderName}</span>
                {senderName !== senderAddress && (
                  <span className="text-xs text-muted-foreground truncate">
                    &lt;{senderAddress}&gt;
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {format(new Date(email.date), "EEEE, MMM d, yyyy 'at' h:mm a")}
              </p>
            </div>
          </div>

          <Separator className="my-5" />

          {loadingContent ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : fullEmail?.htmlBody ? (
            <EmailIframe html={fullEmail.htmlBody} />
          ) : fullEmail?.textBody ? (
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
              {fullEmail.textBody}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No email body available
            </p>
          )}

          {!loadingAttachments && attachments.length > 0 && (
            <>
              <Separator className="my-5" />
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {attachments.length} attachment
                    {attachments.length !== 1 && "s"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att) => (
                    <button
                      key={att.index}
                      type="button"
                      onClick={() => handleDownload(att)}
                      disabled={downloadingIdx === att.index}
                      className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left hover:bg-muted/50 transition-colors max-w-60 group"
                    >
                      <File className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">
                          {att.filename}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatFileSize(att.size)}
                        </p>
                      </div>
                      {downloadingIdx === att.index ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                      ) : (
                        <Download className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
