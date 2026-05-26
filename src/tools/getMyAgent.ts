/**
 * getMyAgent(name) → {id, name, runtime, status, plugins, channels, createdAt, ...}
 *
 * Detail view of one of the calling wallet's agents. Looks up by NAME
 * (globally unique) in the /agents/{name} registry, then verifies the
 * walletAddress field matches the JWT's wallet — refusing to return
 * data for an agent we don't own.
 */

import { z } from "zod";

import { db } from "../firestore.js";
import type { Tool } from "./types.js";

const InputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "name must be alphanumeric / underscore / dash"),
});

function tsToIso(value: unknown): string | null {
  if (!value) return null;
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

export const getMyAgent: Tool<typeof InputSchema> = {
  name: "getMyAgent",
  kind: "read",
  role: "user",
  description:
    "Get details about one of the calling wallet's agents by name. Returns runtime, status, plugins, channels, creation date.",
  input: InputSchema,
  async run({ args, ctx }) {
    // Global registry is the source of truth for name → owner.
    const registry = await db().collection("agents").doc(args.name).get();
    if (!registry.exists) {
      return {
        ok: false,
        errorClass: "NOT_FOUND",
        message: `No agent named "${args.name}".`,
      };
    }
    const reg = registry.data() as Record<string, unknown>;
    const owner =
      typeof reg.walletAddress === "string"
        ? reg.walletAddress.toLowerCase()
        : null;
    if (owner !== ctx.wallet) {
      // Don't leak existence to wrong-owner callers — same response
      // as NOT_FOUND so this can't be used to probe other wallets'
      // agent names.
      return {
        ok: false,
        errorClass: "NOT_FOUND",
        message: `No agent named "${args.name}".`,
      };
    }

    // Hydrate from the per-wallet doc for the full UI-shaped record.
    const agentId =
      typeof reg.agentId === "string" ? reg.agentId : null;
    if (!agentId) {
      // Registry-only entry, no per-wallet doc — return what we have.
      return {
        ok: true,
        data: {
          name: args.name,
          runtime: reg.runtime ?? null,
          status: reg.status ?? null,
          plugins: Array.isArray(reg.plugins) ? reg.plugins : [],
          createdAt: tsToIso(reg.createdAt),
        },
      };
    }
    const walletDoc = await db()
      .collection("wallets")
      .doc(ctx.wallet)
      .collection("agents")
      .doc(agentId)
      .get();
    const walletData = walletDoc.exists
      ? (walletDoc.data() as Record<string, unknown>)
      : {};

    return {
      ok: true,
      data: {
        id: agentId,
        name: args.name,
        runtime: walletData.runtime ?? reg.runtime ?? null,
        status: walletData.status ?? reg.status ?? null,
        plugins: Array.isArray(walletData.plugins)
          ? walletData.plugins
          : Array.isArray(reg.plugins)
            ? reg.plugins
            : [],
        modelKeyProvided: Boolean(walletData.modelKeyProvided),
        createdAt: tsToIso(walletData.createdAt ?? reg.createdAt),
        updatedAt: tsToIso(walletData.updatedAt),
        provisionJobId:
          typeof walletData.provisionJobId === "string"
            ? walletData.provisionJobId
            : null,
      },
    };
  },
};
