/**
 * Fastify auth middleware. Reads the JWT from `Authorization: Bearer
 * …`, validates, and attaches `request.ctx = { wallet, convId, role,
 * requestId }` for downstream tool handlers.
 *
 * The middleware also seeds the request log binding with the
 * requestId + wallet so every log line in the request lifecycle is
 * tenant-tagged for the audit trail.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import { getMetrics } from "../metrics.js";
import { verifyToken, type TokenClaims } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `authMiddleware` once the JWT is verified. */
    ctx?: TokenClaims;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    getMetrics().authFailures.inc({ reason: "missing-or-malformed-header" });
    await reply.code(401).send({
      error: "Missing or malformed Authorization header.",
    });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  const result = verifyToken(token);
  if (!result.ok) {
    request.log.warn({ reason: result.reason }, "jwt verify failed");
    getMetrics().authFailures.inc({ reason: result.reason });
    await reply.code(401).send({ error: `Auth failed: ${result.reason}` });
    return;
  }

  request.ctx = result.claims;
  // Bind audit-relevant fields into the per-request logger so EVERY
  // subsequent log line carries tenant context without manual passing.
  request.log = request.log.child({
    wallet: result.claims.wallet,
    requestId: result.claims.requestId,
    role: result.claims.role,
  });
}

/** Tighter guard for admin-only tools. */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.ctx) {
    // authMiddleware not yet run — programming error.
    await reply.code(500).send({ error: "Auth context missing" });
    return;
  }
  if (request.ctx.role !== "admin") {
    request.log.warn(
      { tool: request.url },
      "admin tool denied (caller role=user)",
    );
    await reply
      .code(403)
      .send({ error: "Admin role required for this tool." });
    return;
  }
}
