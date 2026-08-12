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
