/**
 * Fastify app entrypoint.
 *
 *   node dist/server.js     (production)
 *   npm run dev             (tsx watch for development)
 *
 * The process is a single long-lived server; graceful shutdown on
 * SIGTERM lets in-flight requests finish before exit.
 */

import Fastify from "fastify";

import { config } from "./config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerV1Routes } from "./routes/v1.js";
import { startReaper, stopReaper } from "./rate-limit.js";

// Let Fastify construct its pino instance from this config — it owns
// the version pinning that matches its FastifyBaseLogger contract.
const loggerOptions = {
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }
    : {}),
};

async function main(): Promise<void> {
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: false,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024, // 1 MB; tool args should be small
  });
  const logger = app.log;

  // Routes.
  await registerHealthRoutes(app);
  await registerV1Routes(app);

  // Cleanup on shutdown.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown signal received");
    stopReaper();
    try {
      await app.close();
      logger.info("server closed cleanly");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  startReaper();

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(
    {
      port: config.PORT,
      host: config.HOST,
      env: config.NODE_ENV,
      tools: 5,
    },
    "perkos-platform-tools-api listening",
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal startup error:", err);
  process.exit(1);
});
