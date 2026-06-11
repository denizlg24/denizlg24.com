export * from "@repo/schemas";

// Desktop-only UI state (holds a DOM File during upload) — not a wire type,
// so it stays out of @repo/schemas.
export interface IChatAttachment {
  id: string;
  file: File;
  name: string;
  type: "image" | "pdf";
  previewUrl?: string;
  uploadedUrl?: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}
