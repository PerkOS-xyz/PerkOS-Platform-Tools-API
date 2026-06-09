/**
 * listDocs({ projectId }) → the project's docs (the docs tree).
 *
 * Wallet from JWT. Returns each doc's id, type (note|plan|spec), title,
 * status (plan docs), draft flag, and parentId. Use this to find a doc to
 * read/edit, or to see what already exists before creating a new one.
 */

import { z } from "zod";

import { db } from "../firestore.js";
import { projectIdSchema, tsToIso } from "./docShared.js";
import type { Tool } from "./types.js";

const InputSchema = z.object({ projectId: projectIdSchema }).strict();

export const listDocs: Tool<typeof InputSchema> = {
  name: "listDocs",
  kind: "read",
  role: "user",
  description:
    "List a project's docs (the docs workspace tree): each doc's id, type (note|plan|spec), title, status, draft flag, parentId. Use to find a doc to read or edit, or before creating a new one.",
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
    const activePlanId =
      typeof pdata.activePlanId === "string" ? pdata.activePlanId : null;

    const snap = await projectRef
      .collection("docs")
      .orderBy("order", "asc")
      .limit(200)
      .get();
    const docs = snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        type: typeof v.type === "string" ? v.type : "note",
        title: typeof v.title === "string" ? v.title : null,
        status: typeof v.status === "string" ? v.status : null,
        draft: v.draft === true,
        parentId: typeof v.parentId === "string" ? v.parentId : null,
        isActivePlan: d.id === activePlanId,
        updatedAt: tsToIso(v.updatedAt),
      };
    });
    return {
      ok: true,
      data: { projectId: args.projectId, docs, count: docs.length, activePlanId },
    };
  },
};
