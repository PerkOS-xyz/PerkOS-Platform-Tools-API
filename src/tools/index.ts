/**
 * Tool registry — the one place that knows about every tool.
 *
 * Adding a new tool: create the file under src/tools/, import it
 * below, push into the array. The catalog route + dispatcher pick
 * it up automatically.
 */

import type { AnyTool } from "./types.js";

import { createTask } from "./createTask.js";
import { explainPlugin } from "./explainPlugin.js";
import { getMyAgent } from "./getMyAgent.js";
import { getRunbookFor } from "./getRunbookFor.js";
import { listMyAgents } from "./listMyAgents.js";
import { listProjectTasks } from "./listProjectTasks.js";
import { postProjectMessage } from "./postProjectMessage.js";
import { searchKnowledge } from "./searchKnowledge.js";
import { updateTaskStatus } from "./updateTaskStatus.js";

export const tools: AnyTool[] = [
  explainPlugin as unknown as AnyTool,
  getMyAgent as unknown as AnyTool,
  getRunbookFor as unknown as AnyTool,
  listMyAgents as unknown as AnyTool,
  searchKnowledge as unknown as AnyTool,
  // Job-board tools (project tasks + chat) — let a PM/orchestrator agent
  // and its workers drive a project board on the platform.
  listProjectTasks as unknown as AnyTool,
  createTask as unknown as AnyTool,
  updateTaskStatus as unknown as AnyTool,
  postProjectMessage as unknown as AnyTool,
];

const byName = new Map<string, AnyTool>();
for (const t of tools) byName.set(t.name, t);

export function findTool(name: string): AnyTool | null {
  return byName.get(name) ?? null;
}
