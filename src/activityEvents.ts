/**
 * Activity events — append-only "what happened" stream consumed by the
 * mini-app's dashboard feed. One event = actor + verb + object, written to
 * /wallets/{wallet}/activity_events. Verbs are shared with the mini-app's
 * app/lib/activityEvents.ts and PerkOS-API's services/activityEvents.ts —
 * keep them in sync.
 *
 * Fire-and-forget: logging must never break the tool call it decorates.
 */

import { FieldValue } from "firebase-admin/firestore";

import { db } from "./firestore.js";

export function logActivity(
  wallet: string,
  event: {
    actorType: "agent" | "user" | "system";
    actor: string;
    verb:
      | "created_task"
      | "moved_task"
      | "started_task"
      | "completed_task"
      | "proposed_plan";
    object: string;
    objectType?: "task" | "project" | "agent" | "plan";
    projectId?: string;
    taskId?: string;
    detail?: string;
  },
): void {
  if (!wallet) return;
  const clean = Object.fromEntries(
    Object.entries(event).filter(([, v]) => v !== undefined && v !== ""),
  );
  try {
    void db()
      .collection("wallets")
      .doc(wallet.toLowerCase())
      .collection("activity_events")
      .add({ ...clean, ts: FieldValue.serverTimestamp() })
      .catch(() => {});
  } catch {
    // Never let activity logging break the tool call it decorates.
  }
}
