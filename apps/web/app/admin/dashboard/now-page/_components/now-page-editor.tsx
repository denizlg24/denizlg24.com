"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Field, FieldError, FieldLabel } from "@repo/ui/field";
import { Textarea } from "@repo/ui/textarea";
import { Clock, Eye, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { AdminPageHeader } from "../../_components/admin-page-header";

const nowPageSchema = z.object({
  content: z.string().min(1, "Content is required"),
});

type NowPageFormValues = z.infer<typeof nowPageSchema>;

interface NowPageEditorProps {
  initialContent: string;
  lastUpdated: string | null;
}

export function NowPageEditor({
  initialContent,
  lastUpdated,
}: NowPageEditorProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [togglePreview, setTogglePreview] = useState(false);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NowPageFormValues>({
    resolver: zodResolver(nowPageSchema),
    defaultValues: {
      content: initialContent,
    },
  });

  const onSubmit = async (values: NowPageFormValues) => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/admin/now-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: values.content }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update now page");
      }

      setSuccessDialog(true);
    } catch (error: any) {
      setErrorDialog(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuccessClose = () => {
    setSuccessDialog(false);
    router.refresh();
  };

  return (
    <>
      <AdminPageHeader
        icon={<Clock className="size-4 text-muted-foreground" />}
        title="Now Page"
      />

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full flex flex-col gap-3 pt-3"
      >
        <Field data-invalid={!!errors.content}>
          <FieldLabel
            className="inline-flex items-center gap-2 w-full"
            htmlFor="content"
          >
            Content (Markdown)
            <Button
              onClick={() => {
                setTogglePreview((prev) => !prev);
              }}
              type="button"
              variant={"outline"}
              size={"icon-sm"}
            >
              {togglePreview ? <PenLine /> : <Eye />}
            </Button>
          </FieldLabel>
          {!togglePreview && (
            <Textarea
              id="content"
              {...register("content")}
              rows={20}
              className="font-mono text-sm min-h-96 max-h-[70vh] overflow-y-auto resize-none"
            />
          )}
          {togglePreview && (
            <div className="min-h-96 max-h-[70vh] overflow-y-auto w-full max-w-full! mx-auto rounded-md border bg-background px-6 sm:px-8 py-8 border-muted shadow-xs">
              <MarkdownRenderer content={watch("content") || ""} />
            </div>
          )}
          {errors.content && <FieldError>{errors.content.message}</FieldError>}
        </Field>

        <div className="flex gap-2">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>

      <Dialog open={!!errorDialog} onOpenChange={() => setErrorDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>{errorDialog}</DialogDescription>
          </DialogHeader>
          <Button onClick={() => setErrorDialog(null)}>Close</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={successDialog} onOpenChange={handleSuccessClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Success</DialogTitle>
            <DialogDescription>
              Now page content updated successfully!
            </DialogDescription>
          </DialogHeader>
          <Button onClick={handleSuccessClose}>Close</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
