/**
 * createDoc({ projectId, type, title, parentId? }) → { docId }
 *
 * Create a new doc in the project's docs workspace. PM-created docs land as
 * DRAFTS (draft=true) in a separate "PM Drafts" section of the tree until a
 * human promotes them — this stops the agent silently cluttering the tree.
 * Wallet from JWT. For a plan doc, status starts at "draft".
 */

import { z } from "zod";

import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firestore.js";
import {
  docIdSchema,
  docTypeSchema,
  nextDocOrder,
  projectIdSchema,
} from "./docShared.js";
import type { Tool } from "./types.js";

const InputSchema = z
  .object({
    projectId: projectIdSchema,
    type: docTypeSchema,
    title: z.string().min(1).max(200),
    parentId: docIdSchema.optional(),
  })
  .strict();

export const createDoc: Tool<typeof InputSchema> = {
  name: "createDoc",
  kind: "action",
  role: "user",
  description:
    "Create a new doc in the project's docs workspace (type: note | plan | spec). Your new doc lands in the 'PM Drafts' section until a human promotes it. Returns the new docId — use it with readDoc / upsertPlanGroup / upsertPlanTask / postDocMessage.",
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

    const docRef = projectRef.collection("docs").doc();
    await docRef.set({
      type: args.type,
      title: args.title,
      status: args.type === "plan" ? "draft" : null,
      parentId: args.parentId ?? null,
      draft: true,
      order: await nextDocOrder(projectRef),
      createdBy: ctx.convId ?? "agent",
      revision: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      data: { docId: docRef.id, type: args.type, draft: true },
    };
  },
};
