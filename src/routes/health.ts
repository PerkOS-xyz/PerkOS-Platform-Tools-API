/**
 * /health and /ready endpoints.
 *
 * /health = liveness probe — process is alive, return 200 always.
 * /ready  = readiness probe — also confirms Firestore reachable; used
 *           by the docker healthcheck + future load balancer to gate
 *           traffic during cold starts.
 */

import type { FastifyInstance } from "fastify";

import { db } from "../firestore.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true, uptime: process.uptime() }));

  app.get("/ready", async (_req, reply) => {
    try {
      // Cheap Firestore round-trip — a single doc read on a stable
      // bootstrap doc. Doesn't need to exist; just confirms connection.
      await db().collection("_health").doc("ping").get();
      return { ok: true, deps: { firestore: "ok" } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(503).send({
        ok: false,
        deps: { firestore: `error: ${msg}` },
      });
    }
  });
}
