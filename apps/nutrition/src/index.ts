import { app } from "./app";
import { env } from "./config/env";
import { connectRedis } from "./infra/redis";
import { logger } from "./shared/logger";

await connectRedis();

const server = app.listen(env.apiPort);

logger.info("server.started", {
  host: server.server?.hostname,
  port: server.server?.port,
});
