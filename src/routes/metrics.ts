/**
 * GET /metrics — Prometheus exposition.
 *
 * Bearer-token gated by `PERKOS_METRICS_TOKEN`. When unset, returns
 * 503 (never anonymous). Constant-time compare on the token to keep
 * the auth path timing-stable.
 *
 * The scraper (Grafana Alloy) lives on the same docker network as
 * this container; the metrics port is the same as the service port,
 * since this is a single-process Fastify app — no per-process metrics
 * server needed like in the miniapp.
 */
import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { config } from "../config.js";
import { renderMetrics } from "../metrics.js";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // length-stable dummy compare so we don't leak length difference
    const pad = Buffer.alloc(Math.max(a.length, b.length, 1), 0);
    timingSafeEqual(pad, pad);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function registerMetricsRoute(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (req, reply) => {
    const expected = config.PERKOS_METRICS_TOKEN;
    if (!expected) {
      return reply
        .code(503)
        .send({ error: "PERKOS_METRICS_TOKEN not set on the server" });
    }
    const header = req.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!constantTimeEqual(presented, expected)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { body, contentType } = await renderMetrics();
    return reply
      .header("content-type", contentType)
      .header("cache-control", "no-store")
      .send(body);
  });
}
