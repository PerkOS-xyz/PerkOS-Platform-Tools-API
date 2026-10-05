/**
 * Coordination log — the project's readable story of who asked whom to do
 * what, and what came back. The web shows it in the project conversation.
 * Same collection and entry shape as PerkOS-API's services/coordinationLog.ts
 * (keep them in sync): /wallets/{wallet}/projects/{projectId}/coordination.
 *
 * Workers usually finish through updateTaskStatus, so this is where their
 * delivered result reaches the conversation. Fire-and-forget: logging must
 * never break the tool call it decorates.
 */

import { FieldValue } from "firebase-admin/firestore";
import { normalizeWalletAddress } from "@perkos/shared-types";

import { db } from "./firestore.js";
import { redactClaimTokens } from "./tools/outputSanitizer.js";

export const COORDINATION_TEXT_MAX = 600;

/** Readable, bounded text with any claim token scrubbed. */
export function coordinationText(text: string): string {
  const clean = redactClaimTokens(text).replace(/[ \t]+\n/g, "\n").trim();
  return clean.length > COORDINATION_TEXT_MAX
    ? `${clean.slice(0, COORDINATION_TEXT_MAX - 1).trimEnd()}…`
    : clean;
}

/** One entry per delivered task, so a resubmission updates it in place. */
export function resultEntryId(taskId: string): string {
  return `result-${taskId}`;
}

export function logDeliveredResult(
  wallet: string,
  projectId: string,
  entry: { agent: string; taskId: string; text: string },
): void {
  const text = coordinationText(entry.text);
  if (!wallet || !projectId || !entry.taskId || !text) return;
  try {
    void db()
      .collection("wallets")
      .doc(normalizeWalletAddress(wallet))
      .collection("projects")
      .doc(projectId)
      .collection("coordination")
      .doc(resultEntryId(entry.taskId))
      .set({
        from: `agent:${entry.agent}`,
        to: "sparky",
        kind: "result",
        taskId: entry.taskId,
        text,
        ok: true,
        ts: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
  } catch {
    // Never let the coordination log break the tool call it decorates.
  }
}
