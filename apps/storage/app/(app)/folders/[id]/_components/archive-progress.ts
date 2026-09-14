import { createElement } from "react";
import { ArchiveToast } from "@/components/archive-toast";
import type { ArchiveProgress } from "@/lib/download";

/** `toast.custom` wants a render function; this keeps the controller free of JSX. */
export function ArchiveToastCard(props: {
  label: string;
  progress: ArchiveProgress;
}) {
  return createElement(ArchiveToast, props);
}
