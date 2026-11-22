"use server";

import { createScreenShare, pairScreenShare } from "@/lib/screen-share";
import { requireMemberSession } from "@/lib/viewer";

export async function openScreenReceiver() {
  await requireMemberSession("/screen");
  return createScreenShare();
}

export async function joinScreenReceiver(input: string) {
  await requireMemberSession("/screen");
  if (typeof input !== "string" || input.length > 20) return null;
  const code = input.toUpperCase().replace(/[-\s]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return null;
  return pairScreenShare(code);
}
