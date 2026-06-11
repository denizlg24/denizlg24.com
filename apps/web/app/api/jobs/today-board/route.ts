import { type NextRequest, NextResponse } from "next/server";
import { collectDayDataToJournal } from "@/lib/journal";
import { connectDB } from "@/lib/mongodb";
import { clearTodayBoard } from "@/lib/whiteboard";
import { Whiteboard } from "@/models/Whiteboard";

export async function GET(request: NextRequest) {
  const token = process.env.TODAY_BOARD_RESET_JOB_TOKEN;
  if (!token || request.headers.get("Authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();
    const today = new Date();

    const alreadyCleared = await Whiteboard.findOneAndUpdate(
      { name: "Today", hasBeenCleared: true },
      { hasBeenCleared: false },
    );

    if (alreadyCleared) {
      await collectDayDataToJournal(today, { includeWhiteboard: false });
      return NextResponse.json({ result: "Already cleared today" });
    }

    await collectDayDataToJournal(today, { includeWhiteboard: true });
    const result = await clearTodayBoard();
    return NextResponse.json({ result });
  } catch (_error) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
