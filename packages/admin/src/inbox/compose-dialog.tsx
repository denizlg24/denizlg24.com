"use client";

import type { IEmailAccount } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: IEmailAccount[];
  selectedAccountId: string | null;
  replyTo?: { address: string; subject: string };
}

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function splitRecipients(value: string) {
  return value
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isSendCapable(account: IEmailAccount) {
  if (typeof account.smtpConfigured === "boolean") {
    return account.smtpConfigured;
  }

  return Boolean(
    account.smtpHost ||
      (account.smtpPasswordSharedWithImap &&
        account.provider &&
        account.provider !== "custom"),
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function totalAttachmentBytes(files: File[]) {
  return files.reduce((total, file) => total + file.size, 0);
}

export function ComposeDialog({
  open,
  onOpenChange,
  accounts,
  selectedAccountId,
  replyTo,
}: ComposeDialogProps) {
  const { client } = useAdmin();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sendCapableAccounts = useMemo(
    () => accounts.filter(isSendCapable),
    [accounts],
  );
  const preferredAccountId =
    selectedAccountId &&
    sendCapableAccounts.some((account) => account._id === selectedAccountId)
      ? selectedAccountId
      : (sendCapableAccounts[0]?._id ?? "");

  const [fromAccountId, setFromAccountId] = useState(preferredAccountId);
  const [to, setTo] = useState(replyTo?.address ?? "");
  const [subject, setSubject] = useState(
    replyTo ? `Re: ${replyTo.subject}` : "",
  );
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFromAccountId(preferredAccountId);
    setTo(replyTo?.address ?? "");
    setSubject(replyTo ? `Re: ${replyTo.subject}` : "");
    setBody("");
    setAttachments([]);
  }, [open, preferredAccountId, replyTo]);

  const selectedAccount = sendCapableAccounts.find(
    (account) => account._id === fromAccountId,
  );
  const showFromSelector = sendCapableAccounts.length > 1;
  const noSendingAccounts = sendCapableAccounts.length === 0;

  const handleAttachmentSelect = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length === 0) return;

    const nextAttachments = [...attachments];
    for (const file of selectedFiles) {
      if (nextAttachments.length >= MAX_ATTACHMENTS) {
        toast.error("Too many attachments");
        break;
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is too large`);
        continue;
      }

      const nextTotalBytes = totalAttachmentBytes(nextAttachments) + file.size;
      if (nextTotalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        toast.error("Attachments are too large");
        break;
      }

      nextAttachments.push(file);
    }

    setAttachments(nextAttachments);
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const handleSend = async () => {
    const recipients = splitRecipients(to);
    if (!fromAccountId || !selectedAccount) {
      toast.error("Choose a sending account");
      return;
    }
    if (
      recipients.length === 0 ||
      recipients.some((email) => !isEmail(email))
    ) {
      toast.error("Enter a valid recipient");
      return;
    }
    if (!body.trim()) {
      toast.error("Write a message body");
      return;
    }

    setSending(true);
    try {
      if (attachments.length > 0) {
        const formData = new FormData();
        formData.set("to", JSON.stringify(recipients));
        formData.set("subject", subject);
        formData.set("text", body);
        for (const file of attachments) {
          formData.append("attachments", file, file.name);
        }
        await client.upload<{ success: true }>(
          `email-accounts/${fromAccountId}/send`,
          formData,
        );
      } else {
        await client.post<{ success: true }>(
          `email-accounts/${fromAccountId}/send`,
          {
            to: recipients,
            subject,
            text: body,
          },
        );
      }
      toast.success("Email sent");
      onOpenChange(false);
      setTo("");
      setSubject("");
      setBody("");
      setAttachments([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!sending) onOpenChange(nextOpen);
      }}
      title={replyTo ? "Reply" : "New Message"}
      description="Write and send a new email"
      className="sm:max-w-2xl"
    >
      <div className="flex flex-col">
        {showFromSelector && (
          <div className="flex items-center gap-3 border-b py-2">
            <Label className="w-14 shrink-0 text-sm text-muted-foreground">
              From:
            </Label>
            <Select value={fromAccountId} onValueChange={setFromAccountId}>
              <SelectTrigger className="h-8 border-0 px-0 shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sendCapableAccounts.map((account) => (
                  <SelectItem key={account._id} value={account._id}>
                    {account.smtpFromAddress || account.user}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {noSendingAccounts && (
          <div className="border-b bg-muted/40 py-2 text-xs text-muted-foreground">
            No account has SMTP sending configured.
          </div>
        )}

        <div className="flex items-center gap-3 border-b py-2">
          <span className="w-14 shrink-0 text-sm text-muted-foreground">
            To:
          </span>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@email.com"
            className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex items-center gap-3 border-b py-2">
          <span className="w-14 shrink-0 text-sm text-muted-foreground">
            Subject:
          </span>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your message..."
          className="min-h-70 resize-none rounded-none border-0 py-4 text-sm shadow-none focus-visible:ring-0"
        />

        {attachments.length > 0 && (
          <div className="border-t py-2">
            <div className="flex flex-wrap gap-2">
              {attachments.map((file, index) => (
                <div
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  className="flex max-w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-48 truncate">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => handleRemoveAttachment(index)}
                    disabled={sending}
                  >
                    <X className="h-3 w-3" />
                    <span className="sr-only">Remove attachment</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t py-3">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleAttachmentSelect}
            disabled={sending || noSendingAccounts}
            aria-label="Attachments"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || noSendingAccounts}
          >
            <Paperclip className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Attach</span>
          </Button>
        </div>
        <Button
          size="sm"
          onClick={handleSend}
          className="gap-2"
          disabled={sending || noSendingAccounts}
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {sending ? "Sending..." : "Send"}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
