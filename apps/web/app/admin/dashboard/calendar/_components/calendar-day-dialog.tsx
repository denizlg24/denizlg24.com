"use client";
import { endOfDay, format, startOfDay } from "date-fns";
import { isSameDay } from "date-fns/isSameDay";
import {
  Bell,
  BellRing,
  Calendar,
  CalendarIcon,
  Clock,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  MapPin,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimePicker } from "@/components/ui/time-picker";
import { fetchFavicon } from "@/lib/fetch-favicon";
import { cn } from "@/lib/utils";
import type { ILeanCalendarEvent } from "@/models/CalendarEvent";

function formatNotificationTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}min`;
  }
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? "1hr" : `${hours}hrs`;
  }
  const days = Math.floor(minutes / 1440);
  return days === 1 ? "1 day" : `${days} days`;
}

type NotificationOption = {
  value: string;
  label: string;
  description?: string;
};

function getSmartNotificationOptions(eventTime: string): NotificationOption[] {
  const [hours, minutes] = eventTime.split(":").map(Number);
  const eventMinutes = hours * 60 + minutes;

  const optionsMap = new Map<number, NotificationOption>();

  const safeAdd = (
    minutesBefore: number,
    label: string,
    type: "standard" | "smart" | "longterm",
  ) => {
    if (minutesBefore < 0) return;

    const existing = optionsMap.get(minutesBefore);

    if (!existing) {
      optionsMap.set(minutesBefore, { value: minutesBefore.toString(), label });
      return;
    }

    if (type === "longterm") {
      optionsMap.set(minutesBefore, { value: minutesBefore.toString(), label });
    } else if (type === "standard" && minutesBefore <= 180) {
      optionsMap.set(minutesBefore, { value: minutesBefore.toString(), label });
    } else if (type === "smart" && minutesBefore > 180) {
      optionsMap.set(minutesBefore, { value: minutesBefore.toString(), label });
    }
  };

  const standardOffsets = [0, 10, 30, 60, 120];
  standardOffsets.forEach((min) => {
    const label =
      min === 0
        ? "At time of event"
        : min < 60
          ? `${min} minutes before`
          : `${min / 60} hour${min === 60 ? "" : "s"} before`;
    safeAdd(min, label, "standard");
  });

  const dayInMins = 24 * 60;

  const anchors = [
    { time: 9 * 60, label: "Start of day (9 AM)" },
    { time: 13 * 60, label: "At lunch (1 PM)" },
    { time: 17 * 60, label: "End of workday (5 PM)" },

    { time: 20 * 60, label: "Night before (8 PM)", prevDay: true },
    { time: 17 * 60, label: "Previous afternoon (5 PM)", prevDay: true },
  ];

  anchors.forEach((anchor) => {
    let offset: number;

    if (anchor.prevDay) {
      offset = eventMinutes + (dayInMins - anchor.time);
    } else {
      offset = eventMinutes - anchor.time;
    }

    if (offset >= 90) {
      safeAdd(offset, anchor.label, "smart");
    }
  });

  const longTerm = [
    { val: 1440, label: "1 day before" },
    { val: 2880, label: "2 days before" },
    { val: 10080, label: "1 week before" },
  ];

  longTerm.forEach((opt) => safeAdd(opt.val, opt.label, "longterm"));

  return Array.from(optionsMap.values()).sort(
    (a, b) => Number(a.value) - Number(b.value),
  );
}
interface EventLink {
  _id?: string;
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

export const CalendarDayDialog = ({
  date,
  events: initialEvents,
  onEventChange,
}: {
  date: Date;
  events?: ILeanCalendarEvent[];
  onEventChange?: () => void;
}) => {
  const [events, setEvents] = useState<ILeanCalendarEvent[]>(
    initialEvents || [],
  );
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [editingEventData, setEditingEventData] =
    useState<ILeanCalendarEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"view" | "add">("view");

  useEffect(() => {
    setEvents(initialEvents || []);
  }, [initialEvents]);

  const eventCount = events.length;
  const hasScheduled = events.some((e) => e.status === "scheduled");
  const hasCompleted = events.some((e) => e.status === "completed");

  const [formData, setFormData] = useState<EventFormData>({
    title: "",
    place: "",
    date: date,
    time: "09:00",
    links: [],
    notifyBySlack: false,
    notifyBeforeMinutes: 15,
  });

  useEffect(() => {
    setFormData((prev) => ({ ...prev, date: date }));
  }, [date]);

  const [newLink, setNewLink] = useState<EventLink>({
    label: "",
    url: "",
    icon: undefined,
  });

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const start = startOfDay(date);
      const end = endOfDay(date);
      const response = await fetch(
        `/api/admin/calendar?start=${start.toISOString()}&end=${end.toISOString()}`,
      );
      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
      }
    } catch (error) {
      console.error("Failed to fetch events:", error);
      toast.error("Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (open) {
      fetchEvents();
      setActiveTab("view");
    }
  }, [open, fetchEvents]);

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

      if (editingEvent) {
        const response = await fetch(`/api/admin/calendar/${editingEvent}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formData.title,
            place: formData.place,
            date: eventDate,
            links: formData.links,
            notifyBySlack: formData.notifyBySlack,
            notifyBeforeMinutes: formData.notifyBeforeMinutes,
          }),
        });

        if (!response.ok) throw new Error("Failed to update event");
        toast.success("Event updated successfully");
      } else {
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
      }

      setFormData({
        title: "",
        place: "",
        date: date,
        time: "09:00",
        links: [],
        notifyBySlack: false,
        notifyBeforeMinutes: 15,
      });
      setEditingEvent(null);
      setEditingEventData(null);
      setActiveTab("view");
      await fetchEvents();
      onEventChange?.();
    } catch (error) {
      console.error("Error saving event:", error);
      toast.error("Failed to save event");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditEvent = (event: ILeanCalendarEvent) => {
    const eventDate = new Date(event.date);
    setFormData({
      title: event.title,
      place: event.place,
      date: eventDate,
      time: eventDate.toTimeString().split(" ")[0].substring(0, 5),
      links: event.links,
      notifyBySlack: event.notifyBySlack,
      notifyBeforeMinutes: event.notifyBeforeMinutes,
    });
    setEditingEvent(event._id);
    setEditingEventData(event);
    setActiveTab("add");
  };

  const handleCancelEvent = async (eventId: string) => {
    try {
      const response = await fetch(`/api/admin/calendar/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "canceled" }),
      });

      if (!response.ok) throw new Error("Failed to cancel event");
      toast.success("Event canceled");
      await fetchEvents();
      onEventChange?.();
    } catch (error) {
      console.error("Error canceling event:", error);
      toast.error("Failed to cancel event");
    }
  };

  const handleUpdateEventTime = async (
    eventId: string,
    newDate: string,
    newTime: string,
  ) => {
    try {
      const eventDate = new Date(`${newDate}T${newTime}`);
      const response = await fetch(`/api/admin/calendar/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: eventDate }),
      });

      if (!response.ok) throw new Error("Failed to update event time");
      toast.success("Event time updated");
      await fetchEvents();
      onEventChange?.();
    } catch (error) {
      console.error("Error updating event time:", error);
      toast.error("Failed to update event time");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div
          className={cn(
            "border bg-background p-1.5 w-full col-span-1 aspect-square h-auto relative hover:bg-surface/50 transition-colors shadow-sm cursor-pointer",
            isSameDay(date, new Date()) && "border-accent border-2",
            hasScheduled && "bg-blue-50 dark:bg-blue-950/20",
            hasCompleted && "bg-green-50 dark:bg-green-950/20",
          )}
        >
          <span className="absolute xs:top-1 top-0 xs:left-1 left-0.5 text-xs font-semibold lg:scale-100 xs:scale-75 scale-65">
            {date.getDate()}
          </span>

          {eventCount > 0 && (
            <div className="absolute bottom-0 left-0 right-0 p-0.5 xs:p-1 space-y-0.5 lg:scale-100 xs:scale-75 scale-65 origin-bottom-left">
              {events.slice(0, 2).map((event) => (
                <div
                  key={event._id}
                  className="flex items-center gap-1 text-xs leading-tight"
                >
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      event.status === "scheduled" && "bg-muted",
                      event.status === "completed" && "bg-accent-strong",
                      event.status === "canceled" && "bg-red-900",
                    )}
                  />
                  <span className="truncate font-medium">{event.title}</span>
                </div>
              ))}
              {eventCount > 2 && (
                <div className="text-xs text-foreground/70 font-medium pl-2.5 whitespace-nowrap">
                  <span className="hidden xs:inline">
                    +{eventCount - 2} more
                  </span>
                  <span className="xs:hidden">+{eventCount - 2}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl md:text-2xl">
            {date.toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Manage your events here.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const newTab = value as "view" | "add";
            setActiveTab(newTab);

            if (newTab === "view" && editingEvent) {
              setEditingEvent(null);
              setEditingEventData(null);
              setFormData({
                title: "",
                place: "",
                date: date,
                time: "09:00",
                links: [],
                notifyBySlack: false,
                notifyBeforeMinutes: 15,
              });
            }
          }}
          className="w-full"
        >
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="view" className="text-xs sm:text-sm">
              View Events
            </TabsTrigger>
            <TabsTrigger value="add" className="text-xs sm:text-sm">
              {editingEvent ? "Edit Event" : "Add to This Day"}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="view"
            className="w-full border rounded-lg p-2 sm:p-4 min-h-50 max-h-125 overflow-y-auto overflow-x-hidden"
          >
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-xs sm:text-sm">
                No events scheduled for this day
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <EventCard
                    key={event._id}
                    event={event}
                    onEdit={handleEditEvent}
                    onCancel={handleCancelEvent}
                    onUpdateTime={handleUpdateEventTime}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="add" className="w-full overflow-x-hidden">
            <form
              onSubmit={handleSubmit}
              className="space-y-4 sm:space-y-6 mt-4"
            >
              <div className="space-y-2">
                <Label htmlFor="title" className="text-sm">
                  Event Title *
                </Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  placeholder="Team meeting, deadline, etc."
                  className="text-sm"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="place" className="text-sm">
                  Place
                </Label>
                <Input
                  id="place"
                  value={formData.place ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, place: e.target.value })
                  }
                  placeholder="Office, Zoom, etc."
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Time *</Label>
                <TimePicker
                  value={formData.time}
                  onChange={(time) => setFormData({ ...formData, time })}
                />
              </div>

              <div className="space-y-3">
                <Label className="text-sm">Related Links</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="Label"
                    value={newLink.label}
                    onChange={(e) =>
                      setNewLink({ ...newLink, label: e.target.value })
                    }
                    className="text-sm"
                  />
                  <Input
                    placeholder="URL"
                    type="url"
                    value={newLink.url}
                    onChange={(e) =>
                      setNewLink({ ...newLink, url: e.target.value })
                    }
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    onClick={handleAddLink}
                    size="icon"
                    variant="outline"
                    className="sm:shrink-0"
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
                            className="w-3 h-3 sm:w-4 sm:h-4 shrink-0"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              e.currentTarget.nextElementSibling?.classList.remove(
                                "hidden",
                              );
                            }}
                          />
                        ) : null}
                        <LinkIcon
                          className={cn(
                            "w-3 h-3 sm:w-4 sm:h-4 shrink-0",
                            link.icon && "hidden",
                          )}
                        />
                        <span className="flex-1 text-xs sm:text-sm truncate">
                          {link.label}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => handleRemoveLink(index)}
                          className="h-8 w-8 shrink-0"
                        >
                          <X className="w-3 h-3 sm:w-4 sm:h-4" />
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
                    disabled={editingEventData?.isNotificationSent}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, notifyBySlack: !!checked })
                    }
                  />
                  <Label
                    htmlFor="notifyBySlack"
                    className="cursor-pointer text-xs sm:text-sm"
                  >
                    Notify by Slack
                    {editingEventData?.isNotificationSent && (
                      <span className="text-muted-foreground ml-2">
                        (Already sent)
                      </span>
                    )}
                  </Label>
                </div>

                {formData.notifyBySlack && (
                  <div className="space-y-2">
                    <Label
                      htmlFor="notifyBeforeMinutes"
                      className="text-xs sm:text-sm"
                    >
                      Notify me
                    </Label>
                    <Select
                      value={(() => {
                        const options = getSmartNotificationOptions(
                          formData.time,
                        );
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
                      disabled={editingEventData?.isNotificationSent}
                    >
                      <SelectTrigger className="text-sm max-w-xs">
                        <SelectValue
                          className="min-w-3xs"
                          placeholder="Select time"
                        />
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

              <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
                {editingEvent && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingEvent(null);
                      setEditingEventData(null);
                      setFormData({
                        title: "",
                        place: "",
                        date: date,
                        time: "09:00",
                        links: [],
                        notifyBySlack: false,
                        notifyBeforeMinutes: 15,
                      });
                      setActiveTab("view");
                    }}
                    className="text-xs sm:text-sm"
                  >
                    Cancel Edit
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={submitting}
                  className="text-xs sm:text-sm"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : editingEvent ? (
                    "Update Event"
                  ) : (
                    "Create Event"
                  )}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

function EventCard({
  event,
  onEdit,
  onCancel,
  onUpdateTime,
}: {
  event: ILeanCalendarEvent;
  onEdit: (event: ILeanCalendarEvent) => void;
  onCancel: (eventId: string) => void;
  onUpdateTime: (eventId: string, date: string, time: string) => void;
}) {
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [editDate, setEditDate] = useState<Date>(new Date(event.date));
  const [editTime, setEditTime] = useState(
    new Date(event.date).toTimeString().split(" ")[0].substring(0, 5),
  );

  const handleSaveTime = () => {
    const dateStr = editDate.toISOString().split("T")[0];
    onUpdateTime(event._id, dateStr, editTime);
    setIsEditingTime(false);
  };

  return (
    <div className="border rounded-lg p-3 sm:p-4 space-y-3 bg-card hover:bg-accent/5 transition-colors">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <h3 className="font-semibold text-sm sm:text-base wrap-break-word">
            {event.title}
          </h3>
          <Badge
            variant={
              event.status === "completed"
                ? "default"
                : event.status === "canceled"
                  ? "destructive"
                  : "secondary"
            }
            className="text-xs shrink-0"
          >
            {event.status}
          </Badge>
          {event.notifyBySlack && (
            <Badge
              variant={event.isNotificationSent ? "default" : "outline"}
              className="text-xs shrink-0 flex items-center gap-1"
            >
              {event.isNotificationSent ? (
                <>
                  <Bell className="w-3 h-3" />
                  <span>Sent</span>
                </>
              ) : (
                <>
                  <BellRing className="w-3 h-3" />
                  <span>
                    {formatNotificationTime(event.notifyBeforeMinutes)}
                  </span>
                </>
              )}
            </Badge>
          )}
        </div>

        <div className="flex gap-1 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit(event)}
            className="text-xs h-8 px-3"
          >
            Edit
          </Button>
          {event.status === "scheduled" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCancel(event._id)}
              className="text-xs h-8 px-3"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {isEditingTime ? (
        <div className="flex gap-2 flex-wrap items-start">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "justify-start text-left font-normal text-xs",
                  !editDate && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-1 h-3 w-3" />
                {editDate ? format(editDate, "PPP") : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={editDate}
                onSelect={(date) => date && setEditDate(date)}
                autoFocus
              />
            </PopoverContent>
          </Popover>
          <TimePicker value={editTime} onChange={(time) => setEditTime(time)} />
          <Button size="sm" onClick={handleSaveTime} className="text-xs h-8">
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsEditingTime(false)}
            className="text-xs h-8"
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground w-full">
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            <span>{new Date(event.date).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            <span>
              {new Date(event.date).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          {event.place && (
            <div className="flex items-center gap-1 truncate max-w-30">
              <MapPin className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
              <span className="truncate">{event.place}</span>
            </div>
          )}
          {/* <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs -ml-2"
            onClick={() => setIsEditingTime(true)}
          >
            Change Time
          </Button> */}
        </div>
      )}

      {event.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {event.links.map((link) => (
            <a
              key={link._id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs sm:text-sm border rounded hover:bg-accent transition-colors break-all"
            >
              {link.icon ? (
                <img
                  src={link.icon}
                  alt=""
                  className="w-3 h-3 sm:w-4 sm:h-4 shrink-0"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    e.currentTarget.nextElementSibling?.classList.remove(
                      "hidden",
                    );
                  }}
                />
              ) : null}
              <ExternalLink
                className={cn(
                  "w-3 h-3 sm:w-4 sm:h-4 shrink-0",
                  link.icon && "hidden",
                )}
              />
              <span className="break-all">{link.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
