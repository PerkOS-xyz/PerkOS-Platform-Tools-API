/**
 * Tool registry — the one place that knows about every tool.
 *
 * Adding a new tool: create the file under src/tools/, import it
 * below, push into the array. The catalog route + dispatcher pick
 * it up automatically.
 */

import type { AnyTool } from "./types.js";

import { explainPlugin } from "./explainPlugin.js";
import { getMyAgent } from "./getMyAgent.js";
import { getRunbookFor } from "./getRunbookFor.js";
import { listMyAgents } from "./listMyAgents.js";
import { searchKnowledge } from "./searchKnowledge.js";

export const tools: AnyTool[] = [
  explainPlugin as unknown as AnyTool,
  getMyAgent as unknown as AnyTool,
  getRunbookFor as unknown as AnyTool,
  listMyAgents as unknown as AnyTool,
  searchKnowledge as unknown as AnyTool,
];

const byName = new Map<string, AnyTool>();
for (const t of tools) byName.set(t.name, t);

export function findTool(name: string): AnyTool | null {
  return byName.get(name) ?? null;
}
