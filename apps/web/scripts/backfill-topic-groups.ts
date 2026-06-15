import { connectDB } from "@/lib/mongodb";
import { computeTopicGroups } from "@/lib/tag-classify";
import { Blog } from "@/models/Blog";
import { Project } from "@/models/Project";

async function main() {
  await connectDB();

  const [blogs, projects] = await Promise.all([
    Blog.find().select("_id tags").lean().exec(),
    Project.find().select("_id tags").lean().exec(),
  ]);

  console.log(`Blogs (${blogs.length}):`);
  let blogsUpdated = 0;
  for (const blog of blogs) {
    const topicGroups = await computeTopicGroups(blog.tags ?? []);
    await Blog.updateOne({ _id: blog._id }, { $set: { topicGroups } }).exec();
    blogsUpdated += 1;
    console.log(`  blog ${blog._id.toString()} -> [${topicGroups.join(", ")}]`);
  }

  console.log(`Projects (${projects.length}):`);
  let projectsUpdated = 0;
  for (const project of projects) {
    const topicGroups = await computeTopicGroups(project.tags ?? []);
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
