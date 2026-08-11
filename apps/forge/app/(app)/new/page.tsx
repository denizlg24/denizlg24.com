"use client";

import { RepoPicker } from "@repo/cloud-ui/deploy/repo-picker";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { configureHref } from "./configure-href";

export default function NewProjectPage() {
  const router = useRouter();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeading title="import a repository" />
      <RepoPicker onSelect={(repo) => router.push(configureHref(repo))} />
    </div>
  );
}
