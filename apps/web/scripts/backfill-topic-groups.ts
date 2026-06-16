import { connectDB } from "@/lib/mongodb";
import { computeProjectTopicGroups } from "@/lib/tag-classify";
import { Project } from "@/models/Project";
import { TagGroup } from "@/models/TagGroup";

async function main() {
  await connectDB();

  // Projects are now classified as a whole against a fixed group list, so the
  // per-tag project mappings cached in TagGroup are obsolete. Blog mappings
  // (context: "blog") stay intact — this migration only touches projects.
  const { deletedCount } = await TagGroup.deleteMany({ context: "project" });
  console.log(`Cleared ${deletedCount ?? 0} stale project tag mappings.`);

  const projects = await Project.find()
    .select("_id title subtitle markdown tags")
    .lean()
    .exec();

  console.log(`Projects (${projects.length}):`);
  let projectsUpdated = 0;
  for (const project of projects) {
    const topicGroups = await computeProjectTopicGroups({
      title: project.title,
      subtitle: project.subtitle,
      markdown: project.markdown,
      tags: project.tags ?? [],
    });
    await Project.updateOne(
      { _id: project._id },
      { $set: { topicGroups } },
    ).exec();
    projectsUpdated += 1;
    console.log(
      `  project ${project._id.toString()} (${project.title}) -> [${topicGroups.join(", ")}]`,
    );
  }

  console.log(JSON.stringify({ projectsUpdated }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
