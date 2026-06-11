"use client";

import { useEffect } from "react";

export const DisableContextMenu = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key === "F12") {
        e.preventDefault();
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("toggle_devtools");
        } catch (_) {}
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <main
      className="w-full h-screen overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </main>
  );
};
