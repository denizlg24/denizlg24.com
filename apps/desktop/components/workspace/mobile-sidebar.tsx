"use client";

import { create } from "zustand";

type MobileSidebarState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

/** Open state of the sidebar sheet on narrow windows. */
export const useMobileSidebar = create<MobileSidebarState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
