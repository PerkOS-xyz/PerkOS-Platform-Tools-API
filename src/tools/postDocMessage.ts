/**
 * postDocMessage({ projectId, docId, text }) → { messageId }
 *
 * Post a message into a DOC's own discussion (distinct from the project-wide
 * chat). This is where the PM explains its edits to that doc ("I proposed 2
 * tasks in Week 1") and answers questions about it. Wallet from JWT; the doc
 * must belong to the calling wallet's project. `from` is "agent" with the
 * caller's conv-derived identity.
 */

import { z } from "zod";

import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firestore.js";
import { docIdSchema, projectIdSchema } from "./docShared.js";
import type { Tool } from "./types.js";

const InputSchema = z
  .object({
    projectId: projectIdSchema,
    docId: docIdSchema,
    text: z.string().min(1).max(4000),
  })
  .strict();

export const postDocMessage: Tool<typeof InputSchema> = {
  name: "postDocMessage",
  kind: "action",
  role: "user",
  description:
    "Post a message into a specific doc's discussion (NOT the project-wide chat). Use this to explain doc edits you made and answer questions about that doc. When you change structure (groups/tasks), post here so humans have a narrative trail. Appears in the doc's Discussion panel.",
  input: InputSchema,
  async run({ args, ctx }) {
    const docRef = db()
      .collection("wallets")
      .doc(ctx.wallet)
      .collection("projects")
      .doc(args.projectId)
      .collection("docs")
      .doc(args.docId);
    if (!(await docRef.get()).exists) {
      return {
        ok: false,
        errorClass: "NOT_FOUND",
        message: `No doc "${args.docId}" in project "${args.projectId}".`,
      };
    }
    const msgRef = docRef.collection("messages").doc();
    await msgRef.set({
      from: "agent",
      text: args.text,
      agentName: ctx.convId ?? "agent",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, data: { messageId: msgRef.id } };
  },
};
