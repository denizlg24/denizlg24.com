"use client";
import { useSearchParams } from "next/navigation";
import { SearchInput } from "./search-input";
import { TagSelect } from "./tag-select";

export const FilterBar = ({
  tags,
  related,
}: {
  tags: string[];
  related: "projects" | "blog";
}) => {
  const searchParams = useSearchParams();
  const query = searchParams.get("query") || "";
  const arrayTags = searchParams.getAll("tags") || [];
  return (
    <div className="w-full flex flex-col items-center justify-between gap-2 xs:flex-row mt-16">
      <SearchInput related={related} query={query} />
      <TagSelect related={related} selected={arrayTags} tags={tags} />
    </div>
  );
};
