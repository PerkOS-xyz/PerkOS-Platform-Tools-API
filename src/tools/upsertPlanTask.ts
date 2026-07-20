/**
 * upsertPlanTask({ projectId, docId?, taskId?, groupId, title, desc?,
 *                  suggestedAgent?, acceptance?, deps? }) → { docId, taskId }
 *
 * Create or update a `planTask` block (a DRAFT task) in a doc. This is a
 * PROPOSAL, not a board task — it becomes a real task only when a human
 * approves the plan (materialization). Wallet from JWT; the calling agent
 * owns the block. Targets the active plan doc unless docId is given.
 */

import { z } from "zod";

import { FieldValue } from "firebase-admin/firestore";

import {
  blockIdSchema,
  docIdSchema,
  ensureDoc,
  nextBlockOrder,
  normalizedPlanLabel,
  projectIdSchema,
  touchDocForEdit,
} from "./docShared.js";
import type { Tool } from "./types.js";

const InputSchema = z
  .object({
    projectId: projectIdSchema,
    docId: docIdSchema.optional(),
    /** Omit to create a new draft task; pass to update an existing one. */
    taskId: blockIdSchema.optional(),
    /** The planGroup this draft task belongs to (from upsertPlanGroup). */
    groupId: blockIdSchema,
    title: z.string().min(1).max(200),
    desc: z.string().max(4000).optional(),
    /** Suggested worker agent by name (humans can override on approval). */
    suggestedAgent: z.string().max(64).optional(),
    acceptance: z.string().max(2000).optional(),
    /** Other planTask block ids this depends on. */
    deps: z.array(blockIdSchema).max(50).optional(),
  })
  .strict();

export const upsertPlanTask: Tool<typeof InputSchema> = {
  name: "upsertPlanTask",
  kind: "action",
  role: "user",
  description:
    "Create or update a DRAFT task in a doc (a proposal, not a board task — it materializes only when a human approves the plan). As the PM, decompose the goal into draft tasks under a group, with a suggestedAgent and acceptance criteria. Targets the active plan doc unless docId is given. Omit taskId to create; pass it to update.",
  input: InputSchema,
  async run({ args, ctx }) {
    const refs = await ensureDoc(ctx.wallet, args.projectId, {
      docId: args.docId,
    });
    if (!refs) {
      return {
        ok: false,
        errorClass: "NOT_FOUND",
        message: `No project "${args.projectId}" for this wallet.`,
      };
    }
    const { docRef } = refs;
    const docSnap = await docRef.get();
    const status = (docSnap.data() as Record<string, unknown>)?.status;
    if (status === "materialized") {
      return {
        ok: false,
        errorClass: "BAD_INPUT",
        message: "This plan is already materialized. Do not add or rewrite approved tasks.",
      };
    }

    const projectSnapshot = await docRef.parent.parent!.get();
    const phase = String(
      (projectSnapshot.data()?.workflow as { phase?: unknown } | undefined)?.phase ?? "",
    );
    if (phase === "awaiting_approval") {
      return {
        ok: false,
        errorClass: "BAD_INPUT",
        message: "This plan is awaiting the user's decision. Do not rewrite it until changes are requested.",
      };
    }

    const blocksCol = docRef.collection("blocks");

    if (args.suggestedAgent) {
      const roster = Array.isArray(projectSnapshot.data()?.agentIds)
        ? (projectSnapshot.data()?.agentIds as unknown[]).filter(
            (name): name is string => typeof name === "string" && name.length > 0,
          )
        : [];
      if (!roster.includes(args.suggestedAgent)) {
        return {
          ok: false,
          errorClass: "BAD_INPUT",
          message: `Unknown suggestedAgent "${args.suggestedAgent}". Use one of the project's exact agent names: ${roster.join(", ") || "(no agents assigned)"}.`,
        };
      }
    }

    // The referenced group must exist and be a planGroup.
    const groupSnap = await blocksCol.doc(args.groupId).get();
    if (!groupSnap.exists || (groupSnap.data() as Record<string, unknown>).type !== "planGroup") {
      return {
        ok: false,
        errorClass: "BAD_INPUT",
        message: `No planGroup "${args.groupId}" — create it with upsertPlanGroup first.`,
      };
    }

    let taskRef = args.taskId ? blocksCol.doc(args.taskId) : blocksCol.doc();
    let existing = args.taskId ? await taskRef.get() : null;
    if (!args.taskId) {
      const blocks = await blocksCol.get();
      const match = blocks.docs.find((block) => {
        const data = block.data() as Record<string, unknown>;
        return data.type === "planTask" &&
          data.groupId === args.groupId &&
          normalizedPlanLabel(data.title) === normalizedPlanLabel(args.title);
      });
      if (match) {
        taskRef = match.ref;
        existing = match;
      }
    }
    if (existing && existing.exists) {
      const data = existing.data() as Record<string, unknown>;
      if (data.type !== "planTask") {
        return {
          ok: false,
          errorClass: "BAD_INPUT",
          message: `Block "${args.taskId}" is not a planTask.`,
        };
      }
    }

    const order =
      existing && existing.exists
        ? ((existing.data() as Record<string, unknown>).order as number) ?? 0
        : await nextBlockOrder(docRef);

    if (existing?.exists) {
      const current = existing.data() as Record<string, unknown>;
      const currentDeps = Array.isArray(current.deps) ? current.deps : [];
      const nextDeps = args.deps ?? [];
      const unchanged =
        current.groupId === args.groupId &&
        normalizedPlanLabel(current.title) === normalizedPlanLabel(args.title) &&
        (current.desc ?? null) === (args.desc ?? null) &&
        (current.suggestedAgent ?? null) === (args.suggestedAgent ?? null) &&
        (current.acceptance ?? null) === (args.acceptance ?? null) &&
        JSON.stringify(currentDeps) === JSON.stringify(nextDeps);
      if (unchanged) {
        return { ok: true, data: { docId: refs.docId, taskId: taskRef.id, unchanged: true } };
      }
    }

    await taskRef.set(
      {
        type: "planTask",
        groupId: args.groupId,
        title: args.title,
        desc: args.desc ?? null,
        suggestedAgent: args.suggestedAgent ?? null,
        acceptance: args.acceptance ?? null,
        deps: args.deps ?? [],
        order,
        owner: ctx.convId ?? "agent",
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing && existing.exists
          ? {}
          : { createdAt: FieldValue.serverTimestamp(), materializedTaskId: null }),
      },
      { merge: true },
    );

    await touchDocForEdit(docRef, status, {
      actor: ctx.convId,
      action: existing && existing.exists ? "plan_task_updated" : "plan_task_created",
      blockId: taskRef.id,
      summary: args.title,
    });

    return { ok: true, data: { docId: refs.docId, taskId: taskRef.id } };
  },
};
