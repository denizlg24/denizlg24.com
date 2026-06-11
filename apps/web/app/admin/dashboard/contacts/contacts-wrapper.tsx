"use client";

import { Archive, Check, Clock, Eye, Send } from "lucide-react";
import { useState } from "react";
import type { ILeanContact } from "@/models/Contact";
import { ContactsTable } from "./contacts-table";

interface ContactsWrapperProps {
  initialContacts: ILeanContact[];
  initialStats: {
    total: number;
    pending: number;
    read: number;
    responded: number;
    archived: number;
  };
}

export function ContactsWrapper({
  initialContacts,
  initialStats,
}: ContactsWrapperProps) {
  const [stats, setStats] = useState(initialStats);

  const handleStatusChange = (oldStatus: string, newStatus: string) => {
    setStats((prev) => ({
      ...prev,
      [oldStatus]: Math.max(0, prev[oldStatus as keyof typeof prev] - 1),
      [newStatus]: prev[newStatus as keyof typeof prev] + 1,
    }));
  };

  return (
    <>
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Send className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.total}
            </span>
            <span className="text-xs text-muted-foreground">Total</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.pending}
            </span>
            <span className="text-xs text-muted-foreground">Pending</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.read}
            </span>
            <span className="text-xs text-muted-foreground">Read</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Check className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.responded}
            </span>
            <span className="text-xs text-muted-foreground">Responded</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Archive className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.archived}
            </span>
            <span className="text-xs text-muted-foreground">Archived</span>
          </div>
        </div>
      </div>

      <ContactsTable
        initialContacts={initialContacts}
        onStatusChange={handleStatusChange}
      />
    </>
  );
}
