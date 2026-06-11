import { type NextRequest, NextResponse } from "next/server";
import { fetchSupportedHolidayCountries } from "@/lib/calendar-sync";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const countries = await fetchSupportedHolidayCountries();
    return NextResponse.json({
      countries: countries.sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    });
  } catch (error) {
    console.error("Error fetching calendar countries:", error);
    return NextResponse.json(
      { error: "Failed to fetch countries" },
      { status: 500 },
    );
  }
}
