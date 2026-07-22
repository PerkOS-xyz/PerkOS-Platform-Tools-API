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
import { planningRunDecision, planningRunError, planningRunIdSchema } from "./planningRun.js";

const InputSchema = z
  .object({
    projectId: projectIdSchema,
    type: docTypeSchema,
    title: z.string().min(1).max(200),
    parentId: docIdSchema.optional(),
    planningRunId: planningRunIdSchema,
  })
  .strict();

export const createDoc: Tool<typeof InputSchema> = {
  name: "createDoc",
  kind: "action",
  role: "user",
  description:
    "Create a new doc in the project's docs workspace (type: note | plan | spec). Plan creation is idempotent: an existing active, unmaterialized plan is reused so out-of-order plan tool calls stay in one document. A new plan becomes the project's active plan. Returns the docId — use it with readDoc / upsertPlanGroup / upsertPlanTask / postDocMessage.",
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

    // Approved workflows have one canonical document. Workers may ask to
    // create a task-specific spec, but returning the approved plan keeps every
    // contribution in the shared workspace and makes retries idempotent.
    const projectData = project.data() as Record<string, unknown>;
    const runDecision = planningRunDecision(
      (projectData.workflow ?? null) as Record<string, unknown> | null,
      args.planningRunId,
    );
    if (runDecision !== "allow" && args.type === "plan") {
      return { ok: false, errorClass: "FORBIDDEN", message: planningRunError(runDecision) };
    }
    const workflow = (projectData.workflow ?? null) as
      | { phase?: string; planId?: string }
      | null;
    if (
      workflow?.planId &&
      ["running", "pm_review", "complete"].includes(String(workflow.phase))
    ) {
      const canonicalRef = projectRef.collection("docs").doc(workflow.planId);
      const canonical = await canonicalRef.get();
      if (canonical.exists) {
        return {
          ok: true,
          data: {
            docId: workflow.planId,
            type: canonical.data()?.type ?? "plan",
            draft: canonical.data()?.draft === true,
            activePlan: true,
            canonical: true,
            reused: true,
          },
          message:
            "This approved workflow uses one canonical project document. Reuse this docId instead of creating a separate deliverable doc.",
        };
      }
    }

    if (args.type === "plan") {
      const activePlanId = projectData.activePlanId;
      if (typeof activePlanId === "string" && activePlanId.length > 0) {
        const activePlanRef = projectRef.collection("docs").doc(activePlanId);
        const activePlan = await activePlanRef.get();
        if (activePlan.exists && activePlan.data()?.status !== "materialized") {
          const currentTitle = activePlan.data()?.title;
          await activePlanRef.set(
            {
              ...(typeof currentTitle === "string" && currentTitle.trim().length > 0
                ? {}
                : { title: args.title }),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          return {
            ok: true,
            data: {
              docId: activePlanId,
              type: "plan",
              draft: activePlan.data()?.draft === true,
              activePlan: true,
              reused: true,
            },
          };
        }
      }
    }

    const docRef = projectRef.collection("docs").doc();
    const now = FieldValue.serverTimestamp();
    const batch = projectRef.firestore.batch();
    batch.set(docRef, {
      type: args.type,
      title: args.title,
      status: args.type === "plan" ? "draft" : null,
      parentId: args.parentId ?? null,
      draft: true,
      order: await nextDocOrder(projectRef),
      createdBy: ctx.convId ?? "agent",
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    // A PM commonly creates a plan and then omits docId on subsequent tool
    // calls because plan tools advertise the active plan as their default.
    // Point the project at the new plan atomically so groups, tasks, reads, and
    // proposePlan cannot silently drift into a second empty document.
    if (args.type === "plan") {
      batch.set(
        projectRef,
        { activePlanId: docRef.id, updatedAt: now },
        { merge: true },
      );
    }
    await batch.commit();

    return {
      ok: true,
      data: {
        docId: docRef.id,
        type: args.type,
        draft: true,
        activePlan: args.type === "plan",
      },
    };
  },
};
