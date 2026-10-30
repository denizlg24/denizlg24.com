import { TZDate } from "@date-fns/tz";
import { createCalendarEvent } from "@/lib/calendar-events";
import { createCard } from "@/lib/kanban";
import { connectDB } from "@/lib/mongodb";
import { KanbanColumn } from "@/models/KanbanColumn";
import { type ActionDeps, ActionError } from "./actions";
import { workspaceService } from "./index";

function localInstant(
  date: string,
  time: string | undefined,
  timeZone: string,
): TZDate {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const [hours = 0, minutes = 0] = (time ?? "00:00").split(":").map(Number);
  return new TZDate(year, month - 1, day, hours, minutes, timeZone);
}

/** The services workflow actions write through, in this process. */
export function workflowActionDeps(timeZone: string): ActionDeps {
  return {
    workspace: workspaceService,
    newId: () => crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    createCard: async (input) => {
      await connectDB();
      const column = await KanbanColumn.findOne({
        _id: input.columnId,
        boardId: input.boardId,
      })
        .select({ _id: 1 })
        .lean();
      if (!column) throw new ActionError("No such column on that board");
      const card = await createCard(input.boardId, input.columnId, {
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.dueDate
          ? {
              dueDate: localInstant(
                input.dueDate,
                undefined,
                timeZone,
              ).toISOString(),
              hasDueTime: false,
            }
          : {}),
      });
      return { id: String(card._id) };
    },
    createEvent: async (input, zone) => {
      const start = localInstant(input.date, input.time, zone);
      const created = await createCalendarEvent(
        input.time
          ? {
              title: input.title,
              isAllDay: false,
              date: start,
              endDate: new Date(
                start.getTime() + input.durationMinutes * 60_000,
              ),
              ...(input.place ? { place: input.place } : {}),
            }
          : {
              title: input.title,
              isAllDay: true,
              calendarDate: input.date,
              ...(input.place ? { place: input.place } : {}),
            },
      );
      if (!created) throw new ActionError("The event could not be created");
      return { id: String(created._id) };
    },
  };
}
