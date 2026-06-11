import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getAdminSession } from "@/lib/require-admin";
import { ProjectForm } from "../_components/project-form";

export default async function NewProjectPage() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/dashboard/projects">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Create Project
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Add a new project to display on your homepage.
          </p>
        </div>
      </div>
      <ProjectForm mode="create" />
    </>
  );
}
