import { redirect } from "next/navigation";

/** The install guide went away with public installs; `source.json` beside it stays. */
export default function IosPage() {
  redirect("/#get-macros");
}
