import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { getAllProjects } from "@/lib/projects";
import { revalidateProjectsContent } from "@/lib/public-content-revalidation";
import { requireAdmin } from "@/lib/require-admin";
import { Project } from "@/models/Project";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const projects = await getAllProjects();
    return NextResponse.json({ projects }, { status: 200 });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      title,
      subtitle,
      images,
      media,
      links,
      markdown,
      tags,
      isActive,
      isFeatured,
    } = body;

    await connectDB();

    const maxOrderProject = await Project.findOne()
      .sort({ order: -1 })
      .select("order")
      .lean()
      .exec();
    const order = maxOrderProject ? maxOrderProject.order + 1 : 1;

    const project = await Project.create({
      title,
      subtitle,
      images: images || [],
      media: media || [],
      links: links || [],
      markdown: markdown || "",
      tags: tags || [],
      isActive: isActive !== undefined ? isActive : true,
      isFeatured: isFeatured !== undefined ? isFeatured : false,
      order,
    });
    revalidateProjectsContent();
    return NextResponse.json(
      {
        message: "Project created successfully",
        project: {
          ...project.toObject(),
          _id: project._id.toString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 },
    );
  }
}
