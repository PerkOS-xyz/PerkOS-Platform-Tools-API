/**
 * createTask({ projectId, name, prompt?, priority?, agent?, parents?,
 *              skills?, goalMode?, acceptanceCriteria? }) → { taskId }
 *
 * Creates a task on a project's job board. Wallet from JWT (ctx.wallet);
 * the project must belong to the calling wallet. This is how a PM /
 * orchestrator agent seeds and assigns work: pass `agent` to assign it
 * to a worker by name, or leave it unassigned (Backlog).
 *
 * Orchestration extras (adapted from the runtimes' local boards):
 *   - `parents`: task ids that must be Done before this one dispatches
 *     (dependency graph — the dispatcher auto-promotes when parents finish).
 *   - `skills`: skill names the worker should apply (hinted in its wake
 *     prompt).
 *   - `goalMode` + `acceptanceCriteria`: the worker's Done submission is
 *     judged against the criteria by the dispatcher's LLM judge; failures
 *     come back to the worker with feedback (Hermes goal_mode pattern).
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
    /** Task ids in THIS project that must be Done before this dispatches. */
    parents: z
      .array(z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/))
      .max(10)
      .optional(),
    /** Skill names the worker should apply (hinted in its wake prompt). */
    skills: z.array(z.string().min(1).max(64)).max(10).optional(),
    /** Judge the worker's Done submission against acceptanceCriteria. */
    goalMode: z.boolean().optional(),
    /** What "done" means — used by the acceptance judge when goalMode. */
    acceptanceCriteria: z.string().max(2000).optional(),
  })
  .strict();

export const createTask: Tool<typeof InputSchema> = {
  name: "createTask",
  kind: "action",
  role: "user",
  description:
    "Create a task on a project's job board (the calling wallet's project). Use this as a PM/orchestrator to break work into tasks and assign them: set `agent` to a worker's name to assign, or omit to leave it in Backlog. Optional orchestration: `parents` (task ids that must finish first — builds a dependency graph), `skills` (what the worker should apply), and `goalMode` + `acceptanceCriteria` (the result is auto-judged against the criteria; failures return to the worker with feedback). Returns the new taskId.",
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

    // Validate parents exist in THIS project (prevents typo'd dependency ids
    // from blocking a task forever).
    const parents = args.parents ?? [];
    if (parents.length > 0) {
      const refs = parents.map((pid) => projectRef.collection("tasks").doc(pid));
      const snaps = await db().getAll(...refs);
      const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
      if (missing.length > 0) {
        return {
          ok: false,
          errorClass: "NOT_FOUND",
          message: `Unknown parent task id(s): ${missing.join(", ")}. Pass ids returned by createTask/listProjectTasks.`,
        };
      }
    }

    const taskRef = projectRef.collection("tasks").doc();
    await taskRef.set({
      name: args.name,
      status: "Backlog",
      priority: args.priority ?? "Medium",
      agent: args.agent ?? null,
      prompt: args.prompt ?? null,
      result: null,
      ...(parents.length > 0 ? { parents } : {}),
      ...(args.skills && args.skills.length > 0 ? { skills: args.skills } : {}),
      ...(args.goalMode === true
        ? {
            goalMode: true,
            acceptanceCriteria: args.acceptanceCriteria ?? null,
            judgeAttempts: 0,
          }
        : {}),
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
      data: {
        taskId: taskRef.id,
        status: "Backlog",
        agent: args.agent ?? null,
        ...(parents.length > 0 ? { parents } : {}),
        ...(args.goalMode === true ? { goalMode: true } : {}),
      },
    };
  },
};
