"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

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
      <div className="flex sm:flex-row flex-col sm:items-center items-start gap-2 justify-between w-full">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Now Page Management
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Edit the markdown content displayed on your /now page.
            {lastUpdated && (
              <>
                {" "}
                Last updated:{" "}
                <span className="font-medium text-foreground">
                  {new Date(lastUpdated).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full flex flex-col gap-6"
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
