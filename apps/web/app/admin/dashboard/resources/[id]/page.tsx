import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/require-admin";
import { Resource } from "@/models/Resource";
import { ResourceCapabilities } from "./_components/resource-capabilities";
import { SubResourcesSection } from "./_components/sub-resources-section";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ResourceDetailPage({ params }: Props) {
  const session = await getAdminSession();
  if (!session) redirect("/auth/login");

  const { id } = await params;

  await connectDB();
  const raw = await Resource.findById(id).lean();
  if (!raw) notFound();

  const resource = {
    _id: raw._id.toString(),
    name: raw.name,
    description: raw.description,
    url: raw.url,
    type: raw.type,
    capabilities: raw.capabilities.map((c) => ({
      _id: c._id.toString(),
      type: c.type,
      label: c.label,
      baseUrl: c.baseUrl,
      config: c.config,
      isActive: c.isActive,
    })),
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <Link
          href="/admin/dashboard/resources"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Resources
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold">{resource.name}</h1>
        {resource.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {resource.description}
          </p>
        )}
      </div>

      <ResourceCapabilities resource={resource} />

      <SubResourcesSection resourceId={resource._id} />
    </div>
  );
}
