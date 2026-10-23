import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WelcomeForm } from "@/app/welcome/welcome-form";
import { findMember } from "@/lib/members";
import { requireSubject } from "@/lib/viewer";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage() {
  if (await findMember(await requireSubject("/welcome"))) redirect("/sofa");
  return <WelcomeForm />;
}
