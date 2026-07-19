/**
 * postProjectMessage({ projectId, text }) → { messageId }
 *
 * Posts a message into a project's chat — how a worker notifies the PM
 * ("task X done") or the PM broadcasts to the team. Shows up live in the
 * app's project Chat tab through PerkOS-Chat. Wallet from
 * JWT; project must belong to the calling wallet. `from` is recorded as
 * "agent" with the caller's conv-derived identity.
 */

import { z } from "zod";

import { db } from "../firestore.js";
import { postProjectChat } from "../projectChat.js";
import type { Tool } from "./types.js";
import { redactClaimTokens } from "./outputSanitizer.js";

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
    const projectData = project.data() as Record<string, unknown>;
    const workflow = (projectData.workflow ?? null) as
      | { phase?: string; convId?: string }
      | null;
    const workflowConvId =
      workflow?.convId && ["running", "pm_review", "complete"].includes(String(workflow.phase))
        ? workflow.convId
        : undefined;
    const message = await postProjectChat({
      wallet: ctx.wallet,
      projectId: args.projectId,
      convId:
        workflowConvId ??
        ((projectData.chatConvId as string | undefined) ?? undefined),
      sender: ctx.convId,
      text: redactClaimTokens(args.text),
      targets: Array.from(
        new Set(
          [
            `user:${ctx.wallet}`,
            projectData.pmAgent
              ? `agent:${String(projectData.pmAgent)}`
              : null,
          ].filter((identity): identity is string => Boolean(identity)),
        ),
      ),
    });
    return { ok: true, data: { messageId: message.id, delivered: message.delivered } };
  },
};
