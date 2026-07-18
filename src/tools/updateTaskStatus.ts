/**
 * updateTaskStatus({ projectId, taskId, status, result?, claimToken?, proof? })
 *   → { ok }
 *
 * Moves a task across the job board and optionally records its result.
 * This is how a worker agent updates the board when it starts/finishes
 * work. Wallet from JWT; project must belong to the calling wallet.
 *
 * Statuses match the app's kanban: Backlog | In progress | Review | Done.
 *
 * Worker protocol (claims): the dispatcher stamps a `claim` on each task it
 * wakes ({ token, agent, expiresAtMs }) and puts the token in the wake prompt.
 * - A matching `claimToken` proves ownership and REFRESHES the claim TTL
 *   (heartbeat) on every update.
 * - A MISMATCHED token on an actively-claimed task is rejected (another worker
 *   owns it).
 * - No token at all is allowed (back-compat with older agents) but recorded.
 *
 * Acceptance loop (goal mode): a task with `goalMode: true` that a worker
 * submits as "Done" is parked in "Review" with `judgePending: true` — the
 * dispatcher's LLM judge then accepts it (→ Done) or sends it back with
 * feedback. The worker is told its submission went to the acceptance check.
 *
 * Proof: optional structured evidence (commands run, links, checks) stored on
 * the task — feeds the run-replay/receipts pipeline.
 */

import { z } from "zod";

import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firestore.js";
import { logActivity } from "../activityEvents.js";
import type { Tool } from "./types.js";
import { redactClaimTokens } from "./outputSanitizer.js";

const ProofSchema = z
  .object({
    status: z.enum(["passed", "failed", "skipped"]),
    label: z.string().max(200).optional(),
    command: z.string().max(500).optional(),
    url: z.string().max(500).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

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
    /** Claim token from the dispatch prompt — proves task ownership. */
    claimToken: z.string().max(64).optional(),
    /** Structured evidence for the deliverable (≤5 entries). */
    proof: z.array(ProofSchema).max(5).optional(),
  })
  .strict();

export const updateTaskStatus: Tool<typeof InputSchema> = {
  name: "updateTaskStatus",
  kind: "action",
  role: "user",
  description:
    "Update a task's status on the job board (Backlog | In progress | Review | Done) and optionally record its result. Use this as a worker to move your task to 'In progress' when you start and to 'Done' (with a result) when you finish. Pass the claimToken from your assignment prompt to prove ownership, and attach `proof` entries (commands/links/checks) as evidence when finishing.",
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
    const data = task.data() as {
      status?: string;
      name?: string;
      agent?: string;
      goalMode?: boolean;
      claim?: { token?: string; agent?: string; expiresAtMs?: number } | null;
    };

    // Done is terminal for a worker. Some agentic models (e.g. Kimi) list the
    // board and "re-open" already-finished tasks (Done → In progress), which
    // makes the dispatcher re-wake them and the model redo the work — an
    // unbounded loop that burns LLM tokens for no new output. Treat re-opening
    // a Done task as a no-op success so the agent moves on instead of churning.
    const current = data.status;
    if (
      current === "Done" &&
      (args.status === "In progress" || args.status === "Backlog")
    ) {
      return {
        ok: true,
        data: { taskId: args.taskId, status: "Done" },
        message: `Task "${args.taskId}" is already Done — leaving it Done. Move on to another task.`,
      };
    }

    // Claim check: an actively-claimed task only accepts updates from the
    // claim holder (matching token). Tokenless calls pass (back-compat).
    const claim = data.claim ?? null;
    const claimActive =
      claim != null &&
      typeof claim.expiresAtMs === "number" &&
      claim.expiresAtMs > Date.now() &&
      typeof claim.token === "string";
    if (claimActive && args.claimToken && args.claimToken !== claim?.token) {
      return {
        ok: false,
        errorClass: "FORBIDDEN",
        message: `Task "${args.taskId}" is claimed by another worker. Work only the task you were assigned.`,
      };
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: FieldValue.serverTimestamp(),
      lastWorkerUpdateAt: FieldValue.serverTimestamp(),
    };
    if (typeof args.result === "string") patch.result = redactClaimTokens(args.result);
    if (args.proof && args.proof.length > 0) {
      patch.proof = FieldValue.arrayUnion(
        ...args.proof.map((p) => ({ ...p, at: Date.now() })),
      );
    }
    // Heartbeat: a valid token refreshes the claim TTL (10 min) so the
    // dispatcher knows the worker is alive on long tasks.
    if (claimActive && args.claimToken === claim?.token) {
      patch["claim.expiresAtMs"] = Date.now() + 10 * 60_000;
    }

    // Goal mode: a Done submission goes to the acceptance judge instead.
    let effectiveStatus = args.status;
    let message: string | undefined;
    if (args.status === "Done" && data.goalMode === true) {
      effectiveStatus = "Review";
      patch.status = "Review";
      patch.judgePending = true;
      message =
        "Submitted for the acceptance check. If it doesn't meet the task's acceptance criteria you'll be re-assigned with feedback — otherwise it will be marked Done automatically.";
    }
    // Terminal statuses release the worker-protocol flag.
    if (effectiveStatus === "Done" || effectiveStatus === "Review") {
      patch.workerProtocol = FieldValue.delete();
    }

    await taskRef.update(patch);

    // Keep the dispatcher-wide per-agent lease in sync with the task claim.
    // This is what preserves one active task per single-session runtime across
    // API replicas and across projects, including tasks longer than 10 min.
    if (claimActive && args.claimToken === claim?.token && data.agent?.trim()) {
      const leaseRef = db()
        .collection("agent_dispatch_leases")
        .doc(`${ctx.wallet}__${data.agent.trim()}`);
      await db().runTransaction(async (tx) => {
        const lease = await tx.get(leaseRef);
        if (!lease.exists || lease.data()?.token !== args.claimToken) return;
        if (effectiveStatus === "Done" || effectiveStatus === "Review") {
          tx.delete(leaseRef);
          return;
        }
        tx.set(
          leaseRef,
          {
            expiresAtMs: Date.now() + 10 * 60_000,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
    }

    // Activity feed: narrate the transition in plain language (only on a real
    // status CHANGE — claim-heartbeat updates with the same status are noise).
    if (effectiveStatus !== current) {
      const actor = data.agent?.trim() || claim?.agent || "Worker";
      const verb =
        effectiveStatus === "Done"
          ? ("completed_task" as const)
          : effectiveStatus === "In progress" && current !== "Review"
            ? ("started_task" as const)
            : ("moved_task" as const);
      const detail =
        effectiveStatus === "Review"
          ? "submitted for review"
          : verb === "moved_task"
            ? `→ ${effectiveStatus}`
            : undefined;
      logActivity(ctx.wallet, {
        actorType: "agent",
        actor,
        verb,
        object: data.name ?? args.taskId,
        objectType: "task",
        projectId: args.projectId,
        taskId: args.taskId,
        detail,
      });
    }

    return {
      ok: true,
      data: { taskId: args.taskId, status: effectiveStatus },
      ...(message ? { message } : {}),
    };
  },
};
