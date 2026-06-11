"use client";

import { PopoverClose } from "@radix-ui/react-popover";
import { Clock } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface TimePickerProps {
  value: string;
  onChange: (time: string) => void;
  className?: string;
}

export function TimePicker({ value, onChange, className }: TimePickerProps) {
  const [hours, minutes] = value.split(":");
  const [localHours, setLocalHours] = React.useState(hours || "09");
  const [localMinutes, setLocalMinutes] = React.useState(minutes || "00");

  React.useEffect(() => {
    const [h, m] = value.split(":");
    setLocalHours(h || "09");
    setLocalMinutes(m || "00");
  }, [value]);

  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "" || (Number(val) >= 0 && Number(val) <= 23)) {
      setLocalHours(val);
    }
  };

  const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "" || (Number(val) >= 0 && Number(val) <= 59)) {
      setLocalMinutes(val);
    }
  };

  const handleApply = () => {
    const paddedHours = localHours.padStart(2, "0");
    const paddedMinutes = localMinutes.padStart(2, "0");
    onChange(`${paddedHours}:${paddedMinutes}`);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <Clock className="mr-2 h-4 w-4" />
          {value || "Select time"}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" className="w-auto p-4" align="start">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="hours">Hours</Label>
              <Input
                id="hours"
                type="number"
                min="0"
                max="23"
                value={localHours}
                onChange={handleHoursChange}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="minutes">Minutes</Label>
              <Input
                id="minutes"
                type="number"
                min="0"
                max="59"
                value={localMinutes}
                onChange={handleMinutesChange}
                className="w-full"
              />
            </div>
          </div>
          <PopoverClose asChild>
            <Button onClick={handleApply} className="w-full">
              Apply
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
