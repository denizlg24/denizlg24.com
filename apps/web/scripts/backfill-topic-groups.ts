import { connectDB } from "@/lib/mongodb";
import { computeTopicGroups } from "@/lib/tag-classify";
import { Blog } from "@/models/Blog";
import { Project } from "@/models/Project";
import { TagGroup } from "@/models/TagGroup";

async function main() {
  await connectDB();

  // Cached mappings predate the per-context taxonomy (and project tags were all
  // collapsing into the blog buckets). Wipe and rebuild so blogs reclassify
  // under the fixed list and projects under the hybrid invent+reuse mode.
  const { deletedCount } = await TagGroup.deleteMany({});
  console.log(`Cleared ${deletedCount ?? 0} cached tag mappings.`);

  const [blogs, projects] = await Promise.all([
    Blog.find().select("_id tags").lean().exec(),
    Project.find().select("_id tags").lean().exec(),
  ]);

  console.log(`Blogs (${blogs.length}):`);
  let blogsUpdated = 0;
  for (const blog of blogs) {
    const topicGroups = await computeTopicGroups(blog.tags ?? [], "blog");
    await Blog.updateOne({ _id: blog._id }, { $set: { topicGroups } }).exec();
    blogsUpdated += 1;
    console.log(`  blog ${blog._id.toString()} -> [${topicGroups.join(", ")}]`);
  }

  console.log(`Projects (${projects.length}):`);
  let projectsUpdated = 0;
  for (const project of projects) {
    const topicGroups = await computeTopicGroups(project.tags ?? [], "project");
    await Project.updateOne(
      { _id: project._id },
      { $set: { topicGroups } },
    ).exec();
    projectsUpdated += 1;
    console.log(
      `  project ${project._id.toString()} -> [${topicGroups.join(", ")}]`,
    );
  }

  console.log(JSON.stringify({ blogsUpdated, projectsUpdated }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
