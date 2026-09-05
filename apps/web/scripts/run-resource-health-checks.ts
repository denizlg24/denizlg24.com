/** Host timer entrypoint; shares the web application's checks and log format. */
import mongoose from "mongoose";
import { runAllHealthChecks } from "../lib/resource-agent";

try {
  const results = await runAllHealthChecks();
  console.log(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      resources: results.map(({ name, status }) => ({ name, status })),
    }),
  );
} catch {
  console.error("Resource health-check cycle failed");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
