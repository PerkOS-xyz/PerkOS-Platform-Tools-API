/**
 * readDoc({ projectId, docId? }) → a doc + its ordered blocks.
 *
 * Wallet from JWT (ctx.wallet), never from input. Reads the given doc, or
 * the project's active plan doc (project.activePlanId) when docId is omitted.
 * Returns the doc meta (type/status) + every block (note | planGroup |
 * planTask) in order, so the PM can see what humans wrote and what it has
 * already proposed before editing. Read-only: never creates a doc.
 */

import { z } from "zod";

import { db } from "../firestore.js";
import { docIdSchema, projectIdSchema, tsToIso } from "./docShared.js";
import type { Tool } from "./types.js";

const InputSchema = z
  .object({
    projectId: projectIdSchema,
    docId: docIdSchema.optional(),
  })
  .strict();

export const readDoc: Tool<typeof InputSchema> = {
  name: "readDoc",
  kind: "read",
  role: "user",
  description:
    "Read a project doc + its blocks in order (note blocks written by humans, plus planGroup/planTask blocks). Reads the active plan doc when docId is omitted. Use listDocs first to pick a docId, and read a doc before proposing or editing structure so you build on the human discussion.",
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

    const pdata = project.data() as Record<string, unknown>;
    const docId =
      args.docId ??
      (typeof pdata.activePlanId === "string" ? pdata.activePlanId : null);
    if (!docId) {
      return {
        ok: true,
        data: { projectId: args.projectId, docId: null, type: null, status: null, blocks: [], count: 0 },
      };
    }

    const docRef = projectRef.collection("docs").doc(docId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return {
        ok: true,
        data: { projectId: args.projectId, docId: null, type: null, status: null, blocks: [], count: 0 },
      };
    }
    const docData = docSnap.data() as Record<string, unknown>;

    const blocksSnap = await docRef
      .collection("blocks")
      .orderBy("order", "asc")
      .limit(500)
      .get();
    const blocks = blocksSnap.docs.map((d) => {
      const b = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        type: typeof b.type === "string" ? b.type : "note",
        order: typeof b.order === "number" ? b.order : 0,
        owner: typeof b.owner === "string" ? b.owner : null,
        text: typeof b.text === "string" ? b.text : null,
        title: typeof b.title === "string" ? b.title : null,
        groupId: typeof b.groupId === "string" ? b.groupId : null,
        desc: typeof b.desc === "string" ? b.desc : null,
        suggestedAgent:
          typeof b.suggestedAgent === "string" ? b.suggestedAgent : null,
        acceptance: typeof b.acceptance === "string" ? b.acceptance : null,
        deps: Array.isArray(b.deps) ? b.deps : [],
        materializedTaskId:
          typeof b.materializedTaskId === "string" ? b.materializedTaskId : null,
        updatedAt: tsToIso(b.updatedAt),
      };
    });

    return {
      ok: true,
      data: {
        projectId: args.projectId,
        docId,
        type: typeof docData.type === "string" ? docData.type : "plan",
        title: typeof docData.title === "string" ? docData.title : null,
        status: typeof docData.status === "string" ? docData.status : null,
        revision: typeof docData.revision === "number" ? docData.revision : 0,
        blocks,
        count: blocks.length,
      },
    };
  },
};
