/**
 * createTask({ projectId, name, prompt?, priority?, agent? }) → { taskId }
 *
 * Creates a task on a project's job board. Wallet from JWT (ctx.wallet);
 * the project must belong to the calling wallet. This is how a PM /
 * orchestrator agent seeds and assigns work: pass `agent` to assign it
 * to a worker by name, or leave it unassigned (Backlog).
 *
 * "action" kind → the tighter action rate-limit tier.
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
    name: z.string().min(1).max(200),
    prompt: z.string().max(4000).optional(),
    priority: z.enum(["High", "Medium", "Low"]).optional(),
    /** Assign to a worker agent by display name. Optional → unassigned. */
    agent: z.string().max(64).optional(),
  })
  .strict();

export const createTask: Tool<typeof InputSchema> = {
  name: "createTask",
  kind: "action",
  role: "user",
  description:
    "Create a task on a project's job board (the calling wallet's project). Use this as a PM/orchestrator to break work into tasks and assign them: set `agent` to a worker's name to assign, or omit to leave it in Backlog. Returns the new taskId.",
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

    const taskRef = projectRef.collection("tasks").doc();
    await taskRef.set({
      name: args.name,
      status: "Backlog",
      priority: args.priority ?? "Medium",
      agent: args.agent ?? null,
      prompt: args.prompt ?? null,
      result: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // Keep the denormalized counter the app maintains in sync.
    await projectRef.set(
      { tasks: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    // Event-driven dispatch index (scales to many projects without a
    // collection-group index): when a task is ASSIGNED, mark its board as
    // active so the dispatcher only scans boards with pending work. The
    // dispatcher clears the marker once a board has no Backlog tasks left.
    if (args.agent) {
      await db()
        .collection("active_boards")
        .doc(`${ctx.wallet}__${args.projectId}`)
        .set(
          { wallet: ctx.wallet, projectId: args.projectId, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
    }

    return {
      ok: true,
      data: { taskId: taskRef.id, status: "Backlog", agent: args.agent ?? null },
    };
  },
};
