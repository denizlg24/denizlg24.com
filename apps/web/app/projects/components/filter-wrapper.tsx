import { getBlogTopicGroups } from "@/lib/blog";
import { getProjectTopicGroups } from "@/lib/projects";
import { FilterBar } from "./filter-bar";

export async function FilterWrapper({
  fetcher = "projects",
}: {
  fetcher?: "projects" | "blog";
}) {
  const topics =
    fetcher === "projects"
      ? await getProjectTopicGroups()
      : await getBlogTopicGroups();
  return <FilterBar related={fetcher} tags={topics} />;
}
