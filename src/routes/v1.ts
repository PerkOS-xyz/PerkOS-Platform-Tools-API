/**
 * /v1/* — versioned tool surface.
 *
 *   POST /v1/tools/:name  → dispatch a tool call. Body is the tool's
 *                           input JSON. Response shape:
 *                             { ok: true, data: ... }
 *                             { ok: false, errorClass, message }
 *
 * Auth: every request runs through authMiddleware → ctx is attached.
 * Rate limit: per-wallet token bucket; over-limit → 429.
 * Audit: every dispatch (success or fail) is logged to Firestore.
 */

import type { FastifyInstance } from "fastify";

import { audit, redactArgs } from "../audit.js";
import { authMiddleware, requireAdmin } from "../auth/middleware.js";
import { getMetrics } from "../metrics.js";
import { check as rateCheck } from "../rate-limit.js";
import { findTool, tools } from "../tools/index.js";

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  // All /v1/* routes require the JWT.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/v1/")) return;
    await authMiddleware(req, reply);
  });

  // GET /v1/tools — catalog. The bridge fetches this at startup to
  // know what tools to advertise to the LLM.
  app.get("/v1/tools", async (req) => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        kind: t.kind,
        role: t.role,
        description: t.description,
        // Surface zod JSON-schema via toString; for full OpenAPI run
        // a richer converter at build time (out of scope v1).
        inputSchema: JSON.parse(JSON.stringify(t.input._def)),
      })),
      callerWallet: req.ctx?.wallet ?? null,
    };
  });

  // POST /v1/tools/:name — dispatch.
  app.post<{ Params: { name: string }; Body: unknown }>(
    "/v1/tools/:name",
    async (req, reply) => {
      const start = Date.now();
      const metrics = getMetrics();
      const observe = (resultLabel: string) => {
        metrics.requestTotal.inc({ tool: req.params.name, result: resultLabel });
        metrics.requestDuration.observe(
          { tool: req.params.name },
          (Date.now() - start) / 1000,
        );
      };

      const ctx = req.ctx!;
      const name = req.params.name;
      const tool = findTool(name);

      if (!tool) {
        audit(ctx, {
          tool: name,
          ok: false,
          latencyMs: Date.now() - start,
          argsRedacted: {},
          errorClass: "NOT_FOUND",
        });
        observe("not-found");
        return reply
          .code(404)
          .send({ ok: false, errorClass: "NOT_FOUND", message: `Unknown tool "${name}"` });
      }

      // Admin tools require role=admin claim.
      if (tool.role === "admin") {
        await requireAdmin(req, reply);
        if (reply.sent) {
          observe("unauthorized");
          return;
        }
      }

      // Rate limit (per-wallet, per-kind).
      if (!rateCheck(ctx.wallet, tool.kind)) {
        audit(ctx, {
          tool: name,
          ok: false,
          latencyMs: Date.now() - start,
          argsRedacted: {},
          errorClass: "RATE_LIMITED" as never,
        });
        observe("rate-limited");
        return reply.code(429).send({
          ok: false,
          errorClass: "RATE_LIMITED",
          message: `Too many ${tool.kind} calls. Backoff and retry.`,
        });
      }

      // Validate input against the tool's schema.
      const parsed = tool.input.safeParse(req.body ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        audit(ctx, {
          tool: name,
          ok: false,
          latencyMs: Date.now() - start,
          argsRedacted: redactArgs(req.body),
          errorClass: "BAD_INPUT",
        });
        observe("bad-input");
        return reply
          .code(400)
          .send({ ok: false, errorClass: "BAD_INPUT", message: issues });
      }

      // Dispatch.
      try {
        const result = await tool.run({ args: parsed.data, ctx });
        audit(ctx, {
          tool: name,
          ok: result.ok,
          latencyMs: Date.now() - start,
          argsRedacted: redactArgs(parsed.data),
          errorClass: result.ok ? undefined : result.errorClass,
        });
        observe(result.ok ? "success" : "tool-error");
        return reply
          .code(result.ok ? 200 : statusForError(result.errorClass))
          .send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err }, `tool ${name} threw`);
        audit(ctx, {
          tool: name,
          ok: false,
          latencyMs: Date.now() - start,
          argsRedacted: redactArgs(parsed.data),
          errorClass: "INTERNAL",
        });
        observe("internal");
        return reply
          .code(500)
          .send({ ok: false, errorClass: "INTERNAL", message: msg });
      }
    },
  );
}

function statusForError(cls: string): number {
  switch (cls) {
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "BAD_INPUT":
      return 400;
    case "UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}
