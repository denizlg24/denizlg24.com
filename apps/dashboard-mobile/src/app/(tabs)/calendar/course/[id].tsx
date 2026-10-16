import { useLocalSearchParams } from "expo-router";
import { CourseScreen } from "@/features/calendar/course-screen";

export default function Course() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CourseScreen id={id} />;
}
