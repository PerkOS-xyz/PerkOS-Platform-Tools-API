/**
 * postProjectMessage({ projectId, text }) → { messageId }
 *
 * Posts a message into a project's chat — how a worker notifies the PM
 * ("task X done") or the PM broadcasts to the team. Shows up live in the
 * app's project Chat tab (useProjectMessages onSnapshot). Wallet from
 * JWT; project must belong to the calling wallet. `from` is recorded as
 * "agent" with the caller's conv-derived identity.
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
    text: z.string().min(1).max(4000),
  })
  .strict();

export const postProjectMessage: Tool<typeof InputSchema> = {
  name: "postProjectMessage",
  kind: "action",
  role: "user",
  description:
    "Post a message into a project's chat (the calling wallet's project). Use this to notify the PM that a task is complete, ask a question, or broadcast an update to the team. Appears live in the project's Chat tab.",
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
    const msgRef = projectRef.collection("messages").doc();
    await msgRef.set({
      from: "agent",
      text: args.text,
      // convId is "<kind>-<wallet>" / "agent:<name>" style; surface a
      // best-effort sender label for the chat UI.
      agentName: ctx.convId ?? "agent",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, data: { messageId: msgRef.id } };
  },
};
