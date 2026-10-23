import type { Metadata } from "next";

import { SofaPicker } from "@/app/sofa/sofa-picker";
import { listProfiles } from "@/lib/members";
import { readSofa, requireMemberSession } from "@/lib/viewer";

export const metadata: Metadata = { title: "Who's watching?" };

export default async function SofaPage({ searchParams }: PageProps<"/sofa">) {
  const { member } = await requireMemberSession("/sofa");
  const [profiles, sitting] = await Promise.all([
    listProfiles(member.subject),
    readSofa(member.subject),
  ]);
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  return (
    <SofaPicker
      profiles={profiles}
      initial={sitting.map((profile) => profile.id)}
      next={next}
    />
  );
}
