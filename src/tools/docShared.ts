/**
 * Shared helpers for the collaborative docs workspace ("Notes").
 *
 * A project has many DOCS at
 *   /wallets/{wallet}/projects/{projectId}/docs/{docId}
 * Each doc has a type (note | plan | spec), an optional status (plan docs),
 * and an ordered, owned BLOCKS subcollection (block-level ownership, not a
 * CRDT) at
 *   /wallets/{wallet}/projects/{projectId}/docs/{docId}/blocks/{blockId}
 * plus its OWN chat at
 *   /wallets/{wallet}/projects/{projectId}/docs/{docId}/messages/{msgId}
 *
 * Humans own `note` blocks; the PM agent owns `planGroup` / `planTask`
 * blocks. `project.activePlanId` points at the canonical plan doc so the
 * plan tools can default-target it without a docId. PM-created docs land as
 * drafts (draft=true) in a separate tree section until a human promotes them.
 */

import { z } from "zod";

import { FieldValue, type DocumentReference } from "firebase-admin/firestore";

import { db } from "../firestore.js";

export const projectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "projectId must be alphanumeric / _ / -");

export const docIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "docId must be alphanumeric / _ / -");

export const blockIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "block id must be alphanumeric / _ / -");

export const docTypeSchema = z.enum(["note", "plan", "spec"]);

export function tsToIso(value: unknown): string | null {
  if (!value) return null;
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

export type DocRefs = {
  projectRef: DocumentReference;
  docRef: DocumentReference;
  docId: string;
};

function projectRefFor(wallet: string, projectId: string): DocumentReference {
  return db()
    .collection("wallets")
    .doc(wallet)
    .collection("projects")
    .doc(projectId);
}

/**
 * Resolve (and if needed create) a doc to operate on:
 *  - explicit `docId` → ensure that doc exists (create with type/title if not).
 *  - no `docId` → the project's active PLAN doc (project.activePlanId),
 *    creating + linking one (type "plan") on first use.
 * Returns null if the project doesn't belong to the wallet.
 */
export async function ensureDoc(
  wallet: string,
  projectId: string,
  opts?: { docId?: string; type?: "note" | "plan" | "spec"; title?: string; draft?: boolean },
): Promise<DocRefs | null> {
  const projectRef = projectRefFor(wallet, projectId);
  const project = await projectRef.get();
  if (!project.exists) return null;

  if (opts?.docId) {
    const docRef = projectRef.collection("docs").doc(opts.docId);
    if (!(await docRef.get()).exists) {
      await docRef.set({
        type: opts.type ?? "plan",
        title: opts.title ?? null,
        status: (opts.type ?? "plan") === "plan" ? "draft" : null,
        parentId: null,
        draft: opts.draft ?? false,
        order: 0,
        createdBy: "agent",
        revision: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { projectRef, docRef, docId: opts.docId };
  }

  const data = project.data() as Record<string, unknown>;
  const activePlanId =
    typeof data.activePlanId === "string" ? data.activePlanId : null;
  if (activePlanId) {
    const docRef = projectRef.collection("docs").doc(activePlanId);
    if ((await docRef.get()).exists) {
      return { projectRef, docRef, docId: activePlanId };
    }
  }

  const docRef = projectRef.collection("docs").doc();
  await docRef.set({
    type: "plan",
    title: null,
    status: "draft",
    parentId: null,
    draft: false,
    order: 0,
    createdBy: "agent",
    revision: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await projectRef.set(
    { activePlanId: docRef.id, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { projectRef, docRef, docId: docRef.id };
}

/** Next `order` value to append a block at the end of the doc. */
export async function nextBlockOrder(
  docRef: DocumentReference,
): Promise<number> {
  const last = await docRef
    .collection("blocks")
    .orderBy("order", "desc")
    .limit(1)
    .get();
  const top = last.docs[0];
  if (!top) return 0;
  const o = (top.data() as Record<string, unknown>).order;
  return (typeof o === "number" ? o : 0) + 1;
}

/** Next `order` value to append a doc at the end of the project's tree. */
export async function nextDocOrder(
  projectRef: DocumentReference,
): Promise<number> {
  const last = await projectRef
    .collection("docs")
    .orderBy("order", "desc")
    .limit(1)
    .get();
  const top = last.docs[0];
  if (!top) return 0;
  const o = (top.data() as Record<string, unknown>).order;
  return (typeof o === "number" ? o : 0) + 1;
}

/** Bump revision + move a plan doc draft → under_discussion on PM structure edits. */
export async function touchDocForEdit(
  docRef: DocumentReference,
  currentStatus: unknown,
  change?: {
    actor?: string;
    action?: string;
    blockId?: string;
    summary?: string;
  },
): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const patch: Record<string, unknown> = {
    revision: FieldValue.increment(1),
    updatedAt: now,
  };
  if (currentStatus === "draft" || currentStatus == null) {
    patch.status = "under_discussion";
  }
  const batch = docRef.firestore.batch();
  batch.set(docRef, patch, { merge: true });
  batch.set(docRef.collection("revisions").doc(), {
    actor: change?.actor ?? "agent",
    action: change?.action ?? "doc_edited",
    blockId: change?.blockId ?? null,
    summary: change?.summary ?? null,
    createdAt: now,
  });
  await batch.commit();
}
