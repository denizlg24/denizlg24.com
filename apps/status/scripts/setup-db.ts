import { setupDatabase } from "../lib/db";

await setupDatabase();
console.log("Status collections and indexes are ready.");
process.exit(0);
