/**
 * upsertPlanGroup({ projectId, docId?, groupId?, title, order? }) → { docId, groupId }
 *
 * Create or update a `planGroup` block (a task group / sprint section) in a
 * doc. Wallet from JWT; the calling agent owns the block. Targets the doc by
 * docId, or the project's active plan doc when omitted (created on first use).
 * Editing structure moves a plan doc from draft → under_discussion.
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
    /** Omit to create a new group; pass to rename/reorder an existing one. */
    groupId: blockIdSchema.optional(),
    title: z.string().min(1).max(200),
    order: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

export const upsertPlanGroup: Tool<typeof InputSchema> = {
  name: "upsertPlanGroup",
  kind: "action",
  role: "user",
  description:
    "Create or update a task group (a sprint section) in a doc. As the PM, group related work before adding planTasks. Targets the active plan doc unless docId is given. Omit groupId to create a new group; pass it to rename/reorder. Returns the groupId to use with upsertPlanTask.",
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
        message: "This plan is already materialized. Discuss changes in the doc instead of rewriting the approved task structure.",
      };
    }

    const project = await docRef.parent.parent!.get();
    const phase = String((project.data()?.workflow as { phase?: unknown } | undefined)?.phase ?? "");
    if (phase === "awaiting_approval") {
      return {
        ok: false,
        errorClass: "BAD_INPUT",
        message: "This plan is awaiting the user's decision. Do not rewrite it until changes are requested.",
      };
    }

    const blocksCol = docRef.collection("blocks");
    let groupRef = args.groupId
      ? blocksCol.doc(args.groupId)
      : blocksCol.doc();
    let existing = args.groupId ? await groupRef.get() : null;
    if (!args.groupId) {
      const blocks = await blocksCol.get();
      const match = blocks.docs.find((block) => {
        const data = block.data() as Record<string, unknown>;
        return data.type === "planGroup" &&
          normalizedPlanLabel(data.title) === normalizedPlanLabel(args.title);
      });
      if (match) {
        groupRef = match.ref;
        existing = match;
      }
    }
    if (existing && existing.exists) {
      const data = existing.data() as Record<string, unknown>;
      if (data.type !== "planGroup") {
        return {
          ok: false,
          errorClass: "BAD_INPUT",
          message: `Block "${args.groupId}" is not a planGroup.`,
        };
      }
    }

    const order =
      args.order ??
      (existing && existing.exists
        ? ((existing.data() as Record<string, unknown>).order as number) ?? 0
        : await nextBlockOrder(docRef));

    if (existing?.exists) {
      const current = existing.data() as Record<string, unknown>;
      if (
        normalizedPlanLabel(current.title) === normalizedPlanLabel(args.title) &&
        Number(current.order ?? 0) === order
      ) {
        return { ok: true, data: { docId: refs.docId, groupId: groupRef.id, unchanged: true } };
      }
    }

    await groupRef.set(
      {
        type: "planGroup",
        title: args.title,
        order,
        owner: ctx.convId ?? "agent",
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing && existing.exists
          ? {}
          : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    await touchDocForEdit(docRef, status, {
      actor: ctx.convId,
      action: existing && existing.exists ? "plan_group_updated" : "plan_group_created",
      blockId: groupRef.id,
      summary: args.title,
    });

    return { ok: true, data: { docId: refs.docId, groupId: groupRef.id } };
  },
};
