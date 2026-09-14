import { redirect } from "next/navigation";

/** The old address; everything that lived here is now Settings and Devices. */
export default function AccountPage() {
  redirect("/settings");
}
