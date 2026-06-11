"use client";
import { format } from "date-fns";
import { CalendarIcon, Link as LinkIcon, Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { fetchFavicon } from "@/lib/fetch-favicon";
import { cn } from "@/lib/utils";

function getSmartNotificationOptions(
  eventTime: string,
): Array<{ value: string; label: string }> {
  const [hours, minutes] = eventTime.split(":").map(Number);
  const eventMinutes = hours * 60 + minutes;

  const options: Array<{ value: string; label: string }> = [];
  const addedValues = new Set<string>();

  const addOption = (value: string, label: string) => {
    if (!addedValues.has(value)) {
      options.push({ value, label });
      addedValues.add(value);
    }
  };

  if (hours < 12) {
    addOption("0", "At time of event");
    addOption("5", "5 minutes before");
    addOption("15", "15 minutes before");
    addOption("30", "30 minutes before");
    addOption("60", "1 hour before");

    if (hours >= 9) {
      const minutesToDayBefore9AM = eventMinutes + (24 * 60 - 9 * 60);
      addOption(minutesToDayBefore9AM.toString(), "Day before at 9 AM");
    }
  } else if (hours < 18) {
    addOption("0", "At time of event");
    addOption("15", "15 minutes before");
    addOption("30", "30 minutes before");
    addOption("60", "1 hour before");
    addOption("120", "2 hours before");

    if (hours >= 11) {
      const minutesToSameDay9AM = eventMinutes - 9 * 60;
      if (minutesToSameDay9AM > 0) {
        addOption(minutesToSameDay9AM.toString(), "Same day at 9 AM");
      }
    }
  } else {
    addOption("0", "At time of event");
    addOption("30", "30 minutes before");
    addOption("60", "1 hour before");
    addOption("120", "2 hours before");

    const minutesToSameDay9AM = eventMinutes - 9 * 60;
    addOption(minutesToSameDay9AM.toString(), "Same day at 9 AM");

    const minutesToSameDay5PM = eventMinutes - 17 * 60;
    if (minutesToSameDay5PM > 0) {
      addOption(minutesToSameDay5PM.toString(), "Same day at 5 PM");
    }
  }

  addOption("1440", "1 day before");
  addOption("2880", "2 days before");
  addOption("10080", "1 week before");

  return options;
}

interface EventLink {
  label: string;
  icon?: string;
  url: string;
}

interface EventFormData {
  title: string;
  place?: string;
  date: Date;
  time: string;
  links: EventLink[];
  notifyBySlack: boolean;
  notifyBeforeMinutes: number;
}

export const AddEventDialog = ({
  onEventCreated,
}: {
  onEventCreated?: () => void;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);

  const [formData, setFormData] = useState<EventFormData>({
    title: "",
    place: "",
    date: new Date(),
    time: "09:00",
    links: [],
    notifyBySlack: false,
    notifyBeforeMinutes: 15,
  });

  const [newLink, setNewLink] = useState<EventLink>({
    label: "",
    url: "",
    icon: undefined,
  });

  const handleAddLink = async () => {
    if (!newLink.label || !newLink.url) {
      toast.error("Please fill in both label and URL");
      return;
    }

    try {
      const icon = await fetchFavicon(newLink.url);
      const linkToAdd = { ...newLink, icon };

      setFormData({
        ...formData,
        links: [...formData.links, linkToAdd],
      });

      setNewLink({ label: "", url: "", icon: undefined });
    } catch (error) {
      console.error("Error adding link:", error);

      setFormData({
        ...formData,
        links: [...formData.links, { ...newLink }],
      });
      setNewLink({ label: "", url: "", icon: undefined });
    }
  };

  const handleRemoveLink = (index: number) => {
    setFormData({
      ...formData,
      links: formData.links.filter((_, i) => i !== index),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title) {
      toast.error("Please enter a title");
      return;
    }

    setSubmitting(true);
    try {
      const [hours, minutes] = formData.time.split(":").map(Number);
      const eventDate = new Date(formData.date);
      eventDate.setHours(hours, minutes, 0, 0);

      const response = await fetch("/api/admin/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.title,
          place: formData.place,
          date: eventDate,
          links: formData.links,
          status: "scheduled",
          notifyBySlack: formData.notifyBySlack,
          notifyBeforeMinutes: formData.notifyBeforeMinutes,
        }),
      });

      if (!response.ok) throw new Error("Failed to create event");
      toast.success("Event created successfully");

      setFormData({
        title: "",
        place: "",
        date: new Date(),
        time: "09:00",
        links: [],
        notifyBySlack: false,
        notifyBeforeMinutes: 15,
      });
      setOpen(false);
      onEventCreated?.();
    } catch (error) {
      console.error("Error saving event:", error);
      toast.error("Failed to save event");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="mb-4 w-full max-w-4xl mx-auto">
          <Plus />
          Add Event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl!">
        <DialogHeader>
          <DialogTitle>Add New Event</DialogTitle>
          <DialogDescription>
            Create a new calendar event for any date.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="add-title">Event Title *</Label>
            <Input
              id="add-title"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              placeholder="Team meeting, deadline, etc."
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-place">Place</Label>
            <Input
              id="add-place"
              value={formData.place ?? ""}
              onChange={(e) =>
                setFormData({ ...formData, place: e.target.value })
              }
              placeholder="Office, Zoom, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal truncate ",
                      !formData.date && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon />
                    {formData.date ? (
                      format(formData.date, "dd/MM/yy")
                    ) : (
                      <span>Pick a date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  className="w-auto p-0"
                  align="start"
                >
                  <CalendarComponent
                    mode="single"
                    selected={formData.date}
                    onSelect={(date) =>
                      date && setFormData({ ...formData, date })
                    }
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Time *</Label>
              <TimePicker
                value={formData.time}
                onChange={(time) => setFormData({ ...formData, time })}
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Related Links</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Label"
                value={newLink.label}
                onChange={(e) =>
                  setNewLink({ ...newLink, label: e.target.value })
                }
              />
              <Input
                placeholder="URL"
                type="url"
                value={newLink.url}
                onChange={(e) =>
                  setNewLink({ ...newLink, url: e.target.value })
                }
              />
              <Button
                type="button"
                onClick={handleAddLink}
                size="icon"
                variant="outline"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {formData.links.length > 0 && (
              <div className="space-y-2 mt-3">
                {formData.links.map((link, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 border rounded"
                  >
                    {link.icon ? (
                      <img
                        src={link.icon}
                        alt=""
                        className="w-4 h-4"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          e.currentTarget.nextElementSibling?.classList.remove(
                            "hidden",
                          );
                        }}
                      />
                    ) : null}
                    <LinkIcon
                      className={cn("w-4 h-4", link.icon && "hidden")}
                    />
                    <span className="flex-1 text-sm">{link.label}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemoveLink(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                className="border-foreground!"
                id="notifyBySlack"
                checked={formData.notifyBySlack}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, notifyBySlack: !!checked })
                }
              />
              <Label htmlFor="notifyBySlack" className="cursor-pointer">
                Notify by Slack
              </Label>
            </div>

            {formData.notifyBySlack && (
              <div className="space-y-2">
                <Label htmlFor="notifyBeforeMinutes" className="text-sm">
                  Notify me
                </Label>
                <Select
                  value={(() => {
                    const options = getSmartNotificationOptions(formData.time);
                    const currentValue =
                      formData.notifyBeforeMinutes?.toString();

                    const valueExists = options.some(
                      (opt) => opt.value === currentValue,
                    );
                    return valueExists
                      ? currentValue
                      : options[0]?.value || "15";
                  })()}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      notifyBeforeMinutes: Number.parseInt(value, 10),
                    })
                  }
                >
                  <SelectTrigger className="text-sm max-w-xs min-w-3xs!">
                    <SelectValue placeholder="Select time " />
                  </SelectTrigger>
                  <SelectContent className="z-99">
                    {getSmartNotificationOptions(formData.time).map(
                      (option, idx) => (
                        <SelectItem
                          key={`${option.value}-${idx}`}
                          value={option.value}
                        >
                          {option.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Event"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
