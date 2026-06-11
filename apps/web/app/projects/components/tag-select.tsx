"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TagSelect as TagSelectUi } from "@/components/ui/tag-select";
export const TagSelect = ({
  tags,
  selected,
  related,
}: {
  tags: string[];
  selected: string[];
  related: "projects" | "blog";
}) => {
  const [values, setValues] = useState(selected);
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  useEffect(() => {
    const newParams = new URLSearchParams(searchParamsRef.current.toString());
    newParams.delete("tags");
    values.forEach((val) => {
      newParams.append("tags", val);
    });
    router.push(`/${related}?${newParams.toString()}`);
  }, [values, related, router]);
  return (
    <TagSelectUi
      tags={tags}
      values={values}
      onChange={setValues}
      buttonClassName="xs:w-[200px]"
      placeholder="Filter by topic..."
      searchPlaceholder="Search topic..."
      emptyText="No topic found."
      title="Filter by topic"
      selectedLabel={(count) => `${count} topic(s) selected`}
    />
  );
};
