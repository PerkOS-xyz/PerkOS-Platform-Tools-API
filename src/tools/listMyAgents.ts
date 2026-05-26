/**
 * listMyAgents() → array of {id, name, runtime, status, plugins[], createdAt}
 *
 * The wallet is taken from the JWT claims (server-verified by the
 * bridge), NEVER from request body. Reads /wallets/{wallet}/agents/.
 *
 * The LLM has no way to specify a different wallet. Even if it
 * hallucinated a wallet param, the schema doesn't accept one, and the
 * handler would ignore it anyway — `ctx.wallet` is the only source.
 */

import { z } from "zod";

import { db } from "../firestore.js";
import type { Tool } from "./types.js";

const InputSchema = z.object({}).strict();

type AgentSummary = {
  id: string;
  name: string;
  runtime: string;
  status: string;
  plugins: string[];
  createdAt: string | null;
};

function tsToIso(value: unknown): string | null {
  if (!value) return null;
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

export const listMyAgents: Tool<typeof InputSchema> = {
  name: "listMyAgents",
  kind: "read",
  role: "user",
  description:
    "List the agents owned by the calling wallet. Returns one entry per agent with id, name, runtime, current status, and plugin list.",
  input: InputSchema,
  async run({ ctx }) {
    const snap = await db()
      .collection("wallets")
      .doc(ctx.wallet)
      .collection("agents")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const agents: AgentSummary[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: typeof data.name === "string" ? data.name : "(unnamed)",
        runtime: typeof data.runtime === "string" ? data.runtime : "unknown",
        status: typeof data.status === "string" ? data.status : "unknown",
        plugins: Array.isArray(data.plugins)
          ? (data.plugins as unknown[]).filter(
              (p): p is string => typeof p === "string",
            )
          : [],
        createdAt: tsToIso(data.createdAt),
      };
    });

    return { ok: true, data: { agents, count: agents.length } };
  },
};
