"use client";

import { useEffect } from "react";

interface MarkAsReadProps {
  ticketId: string;
  currentStatus: string;
}

export function MarkAsRead({ ticketId, currentStatus }: MarkAsReadProps) {
  useEffect(() => {
    if (currentStatus === "pending") {
      fetch(`/api/admin/contacts/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "read" }),
      }).catch((error) => {
        console.error("Failed to mark as read:", error);
      });
    }
  }, [ticketId, currentStatus]);

  return null;
}
