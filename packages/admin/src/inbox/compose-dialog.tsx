"use client";

import type { IEmailAccount } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import { Paperclip, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import type { ComposeDraft } from "./email-detail";

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: IEmailAccount[];
  selectedAccountId: string | null;
  draft?: ComposeDraft;
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

// Enter in a header field must not send a half-written message.
function holdEnter(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.preventDefault();
}

function totalAttachmentBytes(files: File[]) {
  return files.reduce((total, file) => total + file.size, 0);
}

export function ComposeDialog({
  open,
  onOpenChange,
  accounts,
  selectedAccountId,
  draft,
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
  const [to, setTo] = useState(draft?.to ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  // Reset only when the dialog opens: the account list refetches on open, and
  // re-running on that would wipe a message already being typed.
  const preferredRef = useRef(preferredAccountId);
  preferredRef.current = preferredAccountId;
  useEffect(() => {
    if (!open) return;
    setFromAccountId(preferredRef.current);
    setTo(draft?.to ?? "");
    setSubject(draft?.subject ?? "");
    setBody(draft?.body ?? "");
    setAttachments([]);
  }, [open, draft]);

  useEffect(() => {
    if (!open || fromAccountId) return;
    setFromAccountId(preferredAccountId);
  }, [open, fromAccountId, preferredAccountId]);

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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={draft?.subject || "New message"}
      size="lg"
      onSubmit={handleSend}
      submitLabel="Send"
      submitDisabled={noSendingAccounts}
      pending={sending}
      footerStart={
        <>
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
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || noSendingAccounts}
          >
            <Paperclip />
            Attach
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField
          label="From"
          htmlFor="compose-from"
          error={noSendingAccounts ? "No account with SMTP" : undefined}
        >
          {showFromSelector ? (
            <Select value={fromAccountId} onValueChange={setFromAccountId}>
              <SelectTrigger id="compose-from" className="w-full">
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
          ) : (
            <Input
              id="compose-from"
              value={
                selectedAccount
                  ? selectedAccount.smtpFromAddress || selectedAccount.user
                  : ""
              }
              disabled
              readOnly
            />
          )}
        </FormField>
        <FormField label="To" htmlFor="compose-to">
          <Input
            id="compose-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@example.com"
            autoComplete="off"
            onKeyDown={holdEnter}
          />
        </FormField>
        <FormField
          label="Subject"
          htmlFor="compose-subject"
          className="sm:col-span-2"
        >
          <Input
            id="compose-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={holdEnter}
          />
        </FormField>
        <FormField
          label="Message"
          htmlFor="compose-body"
          className="sm:col-span-2"
        >
          <Textarea
            id="compose-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[22rem] resize-y text-sm leading-relaxed"
          />
        </FormField>
      </FormGrid>

      {attachments.length > 0 ? (
        <List>
          {attachments.map((file, index) => (
            <ListRow
              key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
              leading={<Paperclip />}
              title={file.name}
              meta={formatBytes(file.size)}
              trailing={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => handleRemoveAttachment(index)}
                  disabled={sending}
                >
                  <X />
                </Button>
              }
            />
          ))}
        </List>
      ) : null}
    </FormDialog>
  );
}
