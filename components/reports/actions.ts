"use client";

import { mutate } from "swr";
import { api } from "@/components/shared";
import type { PublishedDoc } from "@/lib/reports/types";

export const reportsKey = "/api/reports";

export async function setShared(id: string, share: boolean) {
  const result = await api<PublishedDoc>(`/api/reports/${id}/share`, {
    method: share ? "POST" : "DELETE",
  });
  void mutate(reportsKey);
  return result;
}

export async function removeReport(id: string) {
  await api<{ ok: true }>(`/api/reports/${id}`, { method: "DELETE" });
  void mutate(reportsKey);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
