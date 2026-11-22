import type { Metadata } from "next";
import { isTv, requireMemberSession } from "@/lib/viewer";
import { ScreenShare } from "./screen-share";

export const metadata: Metadata = { title: "Screen Share" };

export default async function ScreenSharePage() {
  const [, tv] = await Promise.all([requireMemberSession("/screen"), isTv()]);
  return <ScreenShare tv={tv} />;
}
