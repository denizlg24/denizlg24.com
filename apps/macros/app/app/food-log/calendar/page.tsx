import { pageMetadata } from "@/app/metadata"
import { FoodLogCalendarClient } from "./_components/food-log-calendar-client"

export const metadata = pageMetadata(
  "Food Log Calendar",
  "Scan food logging consistency and daily nutrition totals across the calendar."
)

export default function FoodLogCalendarPage() {
  return <FoodLogCalendarClient />
}
