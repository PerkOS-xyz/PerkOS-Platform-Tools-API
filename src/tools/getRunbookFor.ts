/**
 * getRunbookFor(topic) → markdown content of /opt/perkos-runbook/{topic}.md
 *
 * Public tool — no wallet auth gating beyond the standard JWT (still
 * needs a valid wallet token to prevent unauthenticated scraping).
 * Used by the Assistant to fetch a specific runbook entry on demand
 * vs cramming everything into the system prompt.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { config } from "../config.js";
import type { Tool } from "./types.js";

const InputSchema = z.object({
  topic: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/i, "topic must be a slug (a-z, 0-9, dashes only)"),
});

/** List the runbook directory once; cache for the process lifetime
 *  (runbook content is baked into the image at build, so this is safe). */
let cachedTopics: string[] | null = null;
async function listTopics(): Promise<string[]> {
  if (cachedTopics) return cachedTopics;
  try {
    const entries = await readdir(config.RUNBOOK_DIR);
    cachedTopics = entries
      .filter((e) => e.endsWith(".md"))
      .map((e) => e.replace(/\.md$/, ""));
  } catch {
    cachedTopics = [];
  }
  return cachedTopics;
}

export const getRunbookFor: Tool<typeof InputSchema> = {
  name: "getRunbookFor",
  kind: "read",
  role: "user",
  description:
    "Fetch a single PerkOS runbook entry by topic slug. Returns the markdown body.",
  input: InputSchema,
  async run({ args }) {
    const topics = await listTopics();
    // Match by slug stem ignoring numeric prefix like "01-deploy-modes".
    const match = topics.find(
      (t) => t === args.topic || t.replace(/^\d+-/, "") === args.topic,
    );
    if (!match) {
      return {
        ok: false,
        errorClass: "NOT_FOUND",
        message: `No runbook entry for "${args.topic}". Available: ${topics.join(", ")}`,
      };
    }
    const fullPath = path.join(config.RUNBOOK_DIR, `${match}.md`);
    const content = await readFile(fullPath, "utf8");
    return { ok: true, data: { topic: match, content } };
  },
};
