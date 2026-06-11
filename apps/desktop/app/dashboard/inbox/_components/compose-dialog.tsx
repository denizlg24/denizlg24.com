"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replyTo?: { address: string; subject: string };
}

export function ComposeDialog({
  open,
  onOpenChange,
  replyTo,
}: ComposeDialogProps) {
  const [to, setTo] = useState(replyTo?.address ?? "");
  const [subject, setSubject] = useState(
    replyTo ? `Re: ${replyTo.subject}` : "",
  );
  const [body, setBody] = useState("");

  const handleSend = () => {
    toast.info("Send email is not yet implemented");
    onOpenChange(false);
    setTo("");
    setSubject("");
    setBody("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Compose Email</DialogTitle>
        <DialogDescription className="sr-only">
          Write and send a new email
        </DialogDescription>

        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="text-sm font-medium">New Message</span>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center border-b px-5 py-2 gap-3">
            <span className="text-sm text-muted-foreground w-10 shrink-0">
              To:
            </span>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@email.com"
              className="border-0 shadow-none focus-visible:ring-0 px-0 h-8 text-sm"
            />
          </div>

          <div className="flex items-center border-b px-5 py-2 gap-3">
            <span className="text-sm text-muted-foreground w-10 shrink-0 mr-2">
              Subject:
            </span>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="border-0 shadow-none focus-visible:ring-0 px-0 h-8 text-sm"
            />
          </div>

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            className="border-0 shadow-none focus-visible:ring-0 rounded-none min-h-70 resize-none px-5 py-4 text-sm"
          />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t">
          <div />
          <Button size="sm" onClick={handleSend} className="gap-2">
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
