import { currentUser, json } from "@/lib/auth";
import { earningsCalendar, fomcMeetings } from "@/lib/calendar";

export async function GET(request: Request) {
  if (!(await currentUser()))
    return json({ error: "Sign in to view the calendar." }, 401);
  const args = new URL(request.url).searchParams;
  const from = args.get("from") ?? new Date().toISOString().slice(0, 10);
  const days = Number(args.get("days") ?? "5");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 10
  )
    return json({ error: "Choose a start date and 1 to 10 days." }, 400);
  try {
    const result = await earningsCalendar(from, days);
    return json({ ...result, fomc: fomcMeetings });
  } catch {
    return json({ error: "Earnings calendar is unavailable." }, 502);
  }
}
