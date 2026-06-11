"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export const SearchInput = ({
  query,
  related,
}: {
  query: string;
  related: "projects" | "blog";
}) => {
  const [input, setInput] = useState(query);
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  useEffect(() => {
    const timeout = setTimeout(() => {
      const newParams = new URLSearchParams(searchParamsRef.current.toString());
      if (input) {
        newParams.set("query", input);
      } else {
        newParams.delete("query");
      }
      router.push(`/${related}?${newParams.toString()}`);
    }, 300);

    return () => clearTimeout(timeout);
  }, [input, related, router]);

  return (
    <Input
      placeholder={`Search ${related === "projects" ? "projects" : "for posts"}...`}
      className="w-full grow max-w-sm"
      value={input}
      onChange={(e) => setInput(e.target.value)}
    />
  );
};
