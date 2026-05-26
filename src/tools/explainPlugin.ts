/**
 * explainPlugin(pluginId) → {id, label, description, requiredEnv[], examples[]}
 *
 * Static plugin catalog lookup. Catalog is a bundled JSON file (lives
 * at /opt/perkos-plugins/catalog.json inside the container; source of
 * truth is `plugins/catalog.json` in this repo).
 *
 * Read tool, public — no wallet-specific data.
 */

import { readFile } from "node:fs/promises";

import { z } from "zod";

import { config } from "../config.js";
import type { Tool } from "./types.js";

const InputSchema = z.object({
  pluginId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "pluginId must be a slug"),
});

type CatalogEntry = {
  id: string;
  label: string;
  description: string;
  requiredEnv?: string[];
  examples?: string[];
};

let cachedCatalog: CatalogEntry[] | null = null;

async function loadCatalog(): Promise<CatalogEntry[]> {
  if (cachedCatalog) return cachedCatalog;
  try {
    const raw = await readFile(config.PLUGIN_CATALOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { plugins?: CatalogEntry[] };
    cachedCatalog = Array.isArray(parsed.plugins) ? parsed.plugins : [];
  } catch {
    cachedCatalog = [];
  }
  return cachedCatalog;
}

export const explainPlugin: Tool<typeof InputSchema> = {
  name: "explainPlugin",
  kind: "read",
  role: "user",
  description:
    "Describe a PerkOS plugin by id (e.g. 'github', 'vector-memory'). Returns purpose, required env vars, and usage examples.",
  input: InputSchema,
  async run({ args }) {
    const catalog = await loadCatalog();
    const found = catalog.find((p) => p.id === args.pluginId);
    if (!found) {
      const available = catalog.map((p) => p.id).join(", ");
      return {
        ok: false,
        errorClass: "NOT_FOUND",
        message: `No plugin "${args.pluginId}". Available: ${available || "(catalog empty)"}`,
      };
    }
    return { ok: true, data: found };
  },
};
