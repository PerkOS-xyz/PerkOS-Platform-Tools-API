/**
 * listProjectTasks({ projectId }) → the project's job board.
 *
 * Wallet from JWT (ctx.wallet), never from input. Reads
 * /wallets/{wallet}/projects/{projectId}/tasks. Returns one entry per
 * task so a PM/worker agent can see the board state (who has what, in
 * which column). Project must belong to the calling wallet.
 */

import { z } from "zod";

import { db } from "../firestore.js";
import type { Tool } from "./types.js";

const InputSchema = z
  .object({
    projectId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "projectId must be alphanumeric / _ / -"),
  })
  .strict();

function tsToIso(value: unknown): string | null {
  if (!value) return null;
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

export const listProjectTasks: Tool<typeof InputSchema> = {
  name: "listProjectTasks",
  kind: "read",
  role: "user",
  description:
    "List the tasks on a project's job board (the calling wallet's project). Returns each task's id, name, status (Backlog|In progress|Review|Done), priority, assigned agent, prompt, and result. Use to see the board before creating or picking up work.",
  input: InputSchema,
  async run({ args, ctx }) {
    const projectRef = db()
      .collection("wallets")
      .doc(ctx.wallet)
      .collection("projects")
      .doc(args.projectId);
    const project = await projectRef.get();
    if (!project.exists) {
      return {
        ok: false,
        errorClass: "NOT_FOUND",
        message: `No project "${args.projectId}" for this wallet.`,
      };
    }
    const snap = await projectRef
      .collection("tasks")
      .orderBy("createdAt", "asc")
      .limit(200)
      .get();
    const tasks = snap.docs.map((d) => {
      const t = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: typeof t.name === "string" ? t.name : "(untitled)",
        status: typeof t.status === "string" ? t.status : "Backlog",
        priority: typeof t.priority === "string" ? t.priority : "Medium",
        agent: typeof t.agent === "string" ? t.agent : null,
        prompt: typeof t.prompt === "string" ? t.prompt : null,
        result: typeof t.result === "string" ? t.result : null,
        createdAt: tsToIso(t.createdAt),
        updatedAt: tsToIso(t.updatedAt),
      };
    });
    const projectData = project.data() as Record<string, unknown>;
    return {
      ok: true,
      data: {
        projectId: args.projectId,
        projectName:
          typeof projectData.name === "string" ? projectData.name : null,
        tasks,
        count: tasks.length,
      },
    };
  },
};
