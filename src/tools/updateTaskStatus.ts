/**
 * updateTaskStatus({ projectId, taskId, status, result? }) → { ok }
 *
 * Moves a task across the job board and optionally records its result.
 * This is how a worker agent updates the board when it starts/finishes
 * work. Wallet from JWT; project must belong to the calling wallet.
 *
 * Statuses match the app's kanban: Backlog | In progress | Review | Done.
 */

import { z } from "zod";

import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firestore.js";
import type { Tool } from "./types.js";

const InputSchema = z
  .object({
    projectId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "projectId must be alphanumeric / _ / -"),
    taskId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "taskId must be alphanumeric / _ / -"),
    status: z.enum(["Backlog", "In progress", "Review", "Done"]),
    /** Optional result/notes to record (typically when moving to Done). */
    result: z.string().max(8000).optional(),
  })
  .strict();

export const updateTaskStatus: Tool<typeof InputSchema> = {
  name: "updateTaskStatus",
  kind: "action",
  role: "user",
  description:
    "Update a task's status on the job board (Backlog | In progress | Review | Done) and optionally record its result. Use this as a worker to move your task to 'In progress' when you start and to 'Done' (with a result) when you finish.",
  input: InputSchema,
  async run({ args, ctx }) {
    const taskRef = db()
      .collection("wallets")
      .doc(ctx.wallet)
      .collection("projects")
      .doc(args.projectId)
      .collection("tasks")
      .doc(args.taskId);
    const task = await taskRef.get();
    if (!task.exists) {
      return {
        ok: false,
        errorClass: "NOT_FOUND",
        message: `No task "${args.taskId}" in project "${args.projectId}".`,
      };
    }
    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (typeof args.result === "string") patch.result = args.result;
    await taskRef.set(patch, { merge: true });

    return {
      ok: true,
      data: { taskId: args.taskId, status: args.status },
    };
  },
};
