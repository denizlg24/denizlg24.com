import { type ClassValue, clsx } from "clsx";
import { ExternalLinkIcon, FileText } from "lucide-react";
import { FaGithub } from "react-icons/fa6";
import { twMerge } from "tailwind-merge";

export {
  calculateReadingTime,
  getAge,
  string_to_slug,
} from "@repo/utils";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const iconMap = {
  external: ExternalLinkIcon,
  github: FaGithub,
  notepad: FileText,
};

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}
