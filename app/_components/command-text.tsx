"use client";

import { useState } from "react";
import { CopyCommandIcon } from "./copy-command-icon";
import { Button } from "@/components/ui/button";
import { SiGnubash } from "react-icons/si";
import { VscTerminalPowershell } from "react-icons/vsc";

export const CommandText = () => {
  const [shellType, setShellType] = useState<"bash" | "powershell">("bash");

  const installCommands = {
    bash: {
      command:
        "curl -fsSL https://raw.githubusercontent.com/denizlg24/envoy/master/install.sh | sh",
      icon: "$",
    },
    powershell: {
      command:
        "iwr https://raw.githubusercontent.com/denizlg24/envoy/master/install.ps1 | iex",
      icon: "PS>",
    },
  };

  const installCommand = installCommands[shellType];

  return (
    <div className="mb-8 w-full max-w-2xl flex flex-col gap-2 items-center">
      <div className="flex gap-2 flex-wrap items-center">
        <Button
          variant={shellType == "bash" ? "default" : "outline"}
          size={"icon-sm"}
          className={"transition-all"}
          onClick={() => setShellType("bash")}
        >
          <SiGnubash />
        </Button>
        <Button
          variant={shellType == "powershell" ? "default" : "outline"}
          size={"icon-sm"}
          className={"transition-all"}
          onClick={() => setShellType("powershell")}
        >
          <VscTerminalPowershell />
        </Button>
      </div>
      <div className="relative w-full">
        <div className="absolute inset-0 -z-10 rounded-full bg-primary/20 blur-xl"></div>
        <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-card sm:p-4 px-4 py-2 font-mono text-sm backdrop-blur-sm md:text-base">
          <span className="text-primary">{installCommand.icon}</span>
          <code className="flex-1 text-left text-foreground truncate">
            {installCommand.command}
          </code>
          <CopyCommandIcon command={installCommand.command} />
        </div>
      </div>
    </div>
  );
};
