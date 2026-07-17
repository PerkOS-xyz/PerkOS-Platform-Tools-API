/**
 * proposePlan({ projectId, docId? }) → { docId, status, groups, tasks }
 *
 * Mark a plan doc ready for human review: under_discussion → plan_proposed.
 * Bumps the revision and posts a notice into THAT DOC's discussion so the
 * team knows to review + approve. Does NOT create board tasks — that happens
 * server-side only after a human approves. Wallet from JWT; targets the
 * active plan doc unless docId is given.
 */

import { z } from "zod";

import { FieldValue } from "firebase-admin/firestore";

import { docIdSchema, ensureDoc, projectIdSchema } from "./docShared.js";
import { logActivity } from "../activityEvents.js";
import { postProjectChat } from "../projectChat.js";
import type { Tool } from "./types.js";

const InputSchema = z
  .object({
    projectId: projectIdSchema,
    docId: docIdSchema.optional(),
  })
  .strict();

export const proposePlan: Tool<typeof InputSchema> = {
  name: "proposePlan",
  kind: "action",
  role: "user",
  description:
    "Mark a plan doc as proposed (ready for human approval) and notify the team in that doc's discussion. Call this once you've laid out the task groups and draft tasks. The plan only becomes real board tasks after a human approves it in the app. Targets the active plan doc unless docId is given.",
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
    const current = await docRef.get();
    if (current.data()?.status === "materialized") {
      return {
        ok: false,
        errorClass: "BAD_INPUT",
        message: "This plan is already approved and materialized; it cannot be proposed again.",
      };
    }

    const blocksSnap = await docRef.collection("blocks").get();
    let groups = 0;
    let tasks = 0;
    for (const d of blocksSnap.docs) {
      const t = (d.data() as Record<string, unknown>).type;
      if (t === "planGroup") groups += 1;
      else if (t === "planTask") tasks += 1;
    }

    if (tasks === 0) {
      return {
        ok: false,
        errorClass: "BAD_INPUT",
        message:
          "Add at least one draft task (upsertPlanTask) before proposing the plan.",
      };
    }

    const now = FieldValue.serverTimestamp();
    const projectRef = docRef.parent.parent!;
    const batch = projectRef.firestore.batch();
    batch.set(
      docRef,
      { status: "plan_proposed", revision: FieldValue.increment(1), updatedAt: now },
      { merge: true },
    );
    batch.set(
      projectRef,
      {
        workflow: {
          phase: "awaiting_approval",
          planId: refs.docId,
          taskIds: [],
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();

    await docRef.collection("revisions").doc().set({
      actor: ctx.convId ?? "agent",
      action: "plan_proposed",
      summary: `Proposed ${tasks} task${tasks === 1 ? "" : "s"} across ${groups} group${groups === 1 ? "" : "s"}.`,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Notify the team in THIS doc's discussion.
    await docRef.collection("messages").doc().set({
      from: "agent",
      text: `📋 Plan proposed — ${tasks} task${tasks === 1 ? "" : "s"} across ${groups} group${groups === 1 ? "" : "s"}. Review and approve it in this doc.`,
      agentName: ctx.convId ?? "agent",
      createdAt: FieldValue.serverTimestamp(),
    });

    const chatDelivered = await postProjectChat({
      wallet: ctx.wallet,
      projectId: args.projectId,
      convId: ((await projectRef.get()).data()?.chatConvId as string | undefined) ?? undefined,
      sender: ctx.convId,
      targets: [`user:${ctx.wallet}`],
      text: `Plan proposed with ${tasks} task${tasks === 1 ? "" : "s"}. Review the plan and approve it before work starts.`,
      event: {
        domain: "project_workflow",
        type: "plan_proposed",
        projectId: args.projectId,
        phase: "awaiting_approval",
        planId: refs.docId,
        actor: ctx.convId ?? "agent:unknown",
        data: { groups, tasks },
      },
    }).then(() => true).catch(() => false);

    // Activity feed + the dashboard's "Waiting on you" queue.
    logActivity(ctx.wallet, {
      actorType: "agent",
      actor: ctx.convId ?? "PM",
      verb: "proposed_plan",
      object: `${tasks} task${tasks === 1 ? "" : "s"}`,
      objectType: "plan",
      projectId: args.projectId,
    });

    return {
      ok: true,
      data: {
        docId: refs.docId,
        status: "plan_proposed",
        groups,
        tasks,
        chatDelivered,
      },
    };
  },
};
