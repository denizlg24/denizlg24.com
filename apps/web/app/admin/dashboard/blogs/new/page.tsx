import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getAdminSession } from "@/lib/require-admin";
import { BlogForm } from "../_components/blog-form";

export default async function NewBlogPage() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/dashboard/blogs">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Create Blog Post
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Add a new blog post to your website.
          </p>
        </div>
      </div>
      <BlogForm mode="create" />
    </>
  );
}
