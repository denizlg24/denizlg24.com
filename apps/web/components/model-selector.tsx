"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";

export const ModelSelector = ({
  model,
  onModelChange,
  className,
}: {
  model: string;
  onModelChange: (model: string) => void;
  className?: string;
}) => {
  const [showLegacy, setShowLegacy] = useState(false);

  const newGenModels = [
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ];

  const legacyModels = [
    { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  ];

  return (
    <div className={cn("w-full flex flex-col gap-2 items-end", className)}>
      <Select value={model} onValueChange={(value) => onModelChange(value)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent className="z-99">
          <SelectGroup>
            <SelectLabel>Latest Models</SelectLabel>
            {newGenModels.map((model) => (
              <SelectItem key={model.value} value={model.value}>
                {model.label}
              </SelectItem>
            ))}
          </SelectGroup>
          {showLegacy && (
            <SelectGroup>
              <SelectLabel>Legacy Models</SelectLabel>
              {legacyModels.map((model) => (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <div className="flex items-center space-x-2 text-xs">
        <Switch
          id="legacy"
          checked={showLegacy}
          onCheckedChange={setShowLegacy}
          size="sm"
        />
        <Label htmlFor="legacy">Legacy Models</Label>
      </div>
    </div>
  );
};
