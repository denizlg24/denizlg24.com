"use client";
import { MoveRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserSettings } from "@/context/user-context";
export const ApiKeyInput = () => {
  const [input, setInput] = useState("");
  const { loading, setSettings } = useUserSettings();
  const router = useRouter();
  return (
    <>
      <Input
        placeholder="dlg24_xxxxx"
        className="border-border w-full max-w-3xl"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <Button
        onClick={() => {
          setSettings({ apiKey: input });
          router.push("/dashboard");
        }}
        disabled={!input || !input.startsWith("dlg24_") || loading}
        className="w-full max-w-3xl"
      >
        {loading ? "Loading..." : "Get Started"} <MoveRight />
      </Button>
    </>
  );
};
