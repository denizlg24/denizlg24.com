"use client";

import { useParams } from "next/navigation";
import { Browser } from "./_components/browser";

export default function FolderPage() {
  const params = useParams<{ id: string }>();
  if (!params?.id) return null;
  return <Browser key={params.id} folderId={params.id} />;
}
