"use client";

import { Check, Clock, MessageSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CommentWithBlogTitle } from "@/lib/comments";
import { CommentsTable } from "./comments-table";

interface CommentsWrapperProps {
  initialComments: CommentWithBlogTitle[];
  initialStats: {
    total: number;
    pending: number;
    approved: number;
    deleted: number;
  };
}

type StatusFilter = "all" | "pending" | "approved";

export function CommentsWrapper({
  initialComments,
  initialStats,
}: CommentsWrapperProps) {
  const [stats, setStats] = useState(initialStats);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const handleApprovalChange = (
    wasApproved: boolean,
    isNowApproved: boolean,
  ) => {
    if (wasApproved === isNowApproved) return;

    setStats((prev) => ({
      ...prev,
      pending: isNowApproved ? Math.max(0, prev.pending - 1) : prev.pending + 1,
      approved: isNowApproved
        ? prev.approved + 1
        : Math.max(0, prev.approved - 1),
    }));
  };

  const handleDelete = (wasApproved: boolean) => {
    setStats((prev) => ({
      ...prev,
      total: Math.max(0, prev.total - 1),
      pending: wasApproved ? prev.pending : Math.max(0, prev.pending - 1),
      approved: wasApproved ? Math.max(0, prev.approved - 1) : prev.approved,
      deleted: prev.deleted + 1,
    }));
  };

  const filteredComments = initialComments.filter((comment) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "pending") return !comment.isApproved;
    if (statusFilter === "approved") return comment.isApproved;
    return true;
  });

  return (
    <>
      <div className="flex flex-wrap gap-4 items-center mb-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
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
          <Check className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.approved}
            </span>
            <span className="text-xs text-muted-foreground">Approved</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Trash2 className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.deleted}
            </span>
            <span className="text-xs text-muted-foreground">Deleted</span>
          </div>
        </div>
      </div>

      <CommentsTable
        initialComments={filteredComments}
        onApprovalChange={handleApprovalChange}
        onDelete={handleDelete}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Filter by status:
          </span>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CommentsTable>
    </>
  );
}
