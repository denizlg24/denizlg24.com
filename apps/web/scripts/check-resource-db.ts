import mongoose from "mongoose";
import { connectResourceDB } from "@/lib/mongodb-resource";
import { getHealthCheckLogModel } from "@/models/resource-db/HealthCheckLog";
import { getPingResourceModel } from "@/models/resource-db/PingResource";

async function main() {
  await connectResourceDB();
  const HealthCheckLog = await getHealthCheckLogModel();
  const PingResource = await getPingResourceModel();

  const total = await HealthCheckLog.countDocuments();
  console.log("total logs in resource DB:", total);

  const pings = await PingResource.find().lean();
  for (const r of pings) {
    const c = await HealthCheckLog.countDocuments({ resourceId: r._id });
    const latest = await HealthCheckLog.findOne({ resourceId: r._id })
      .sort({ checkedAt: -1 })
      .lean();
    const earliest = await HealthCheckLog.findOne({ resourceId: r._id })
      .sort({ checkedAt: 1 })
      .lean();
    console.log({
      resource: r.name,
      _id: r._id.toString(),
      count: c,
      earliest: earliest?.checkedAt,
      latest: latest?.checkedAt,
      isPublic: r.isPublic,
      isActive: r.isActive,
    });
  }

  // per-day count over last 30 days for first resource
  if (pings[0]) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const perDay = await HealthCheckLog.aggregate([
      { $match: { resourceId: pings[0]._id, checkedAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$checkedAt" } },
          n: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    console.log("\nper-day for", pings[0].name);
    console.log(perDay);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
