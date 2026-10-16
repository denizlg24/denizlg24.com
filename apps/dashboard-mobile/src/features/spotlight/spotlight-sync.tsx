import { DashboardNative, type SpotlightItem } from "@modules/dashboard-native";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useSemesterOverview } from "@/api/calendar";
import { useContacts } from "@/api/inbox";
import { useNotes } from "@/api/more";
import { pathFromUrl } from "@/features/notifications/routing";
import { contactItems, courseItems, noteItems } from "./items";

function index(domain: SpotlightItem["domain"], items: SpotlightItem[]) {
  void DashboardNative?.indexSpotlight(domain, JSON.stringify(items)).catch(
    () => undefined,
  );
}

/**
 * Re-indexes each domain from the cached lists whenever they change, and
 * opens the screen of a Spotlight result the user tapped.
 */
export function SpotlightSync() {
  const router = useRouter();
  const notes = useNotes("");
  const contacts = useContacts();
  const overview = useSemesterOverview();

  useEffect(() => {
    if (notes.data) index("notes", noteItems(notes.data));
  }, [notes.data]);
  useEffect(() => {
    if (contacts.data) index("contacts", contactItems(contacts.data.contacts));
  }, [contacts.data]);
  useEffect(() => {
    if (overview.data) index("courses", courseItems(overview.data.courses));
  }, [overview.data]);

  useEffect(() => {
    const open = () => {
      const path = pathFromUrl(DashboardNative?.takePendingUrl() ?? null);
      if (path) router.push(path);
    };
    open();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      open();
      // The activity can be delivered just after the scene turns active.
      setTimeout(open, 400);
    });
    return () => subscription.remove();
  }, [router]);

  return null;
}
