import { createHash } from "node:crypto";
import { ExecutionEventV1Schema, type ExecutionEventV1 } from "@perkos/shared-types";
import { FieldValue, type DocumentReference, type Transaction } from "firebase-admin/firestore";

import { db } from "./firestore.js";

export type ExecutionEventDraft = Omit<ExecutionEventV1, "schemaVersion" | "eventId" | "sequence" | "recordedAt">;

export type TaskStatusEventInput = {
  wallet: string; projectId: string; taskId: string; taskName: string;
  agentId: string; runId: string; traceId: string; attempt: number;
  currentStatus: string; nextStatus: string; goalMode: boolean;
  proof?: { status: "passed" | "failed" | "skipped"; label?: string }[];
  occurredAt: string;
};

export function executionEventId(runId: string, dedupeKey: string): string {
  return createHash("sha256").update(`${runId}\0${dedupeKey}`).digest("hex");
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .map(([key, child]) => [key, removeUndefined(child)]));
}

export function buildTaskStatusEvents(input: TaskStatusEventInput): ExecutionEventDraft[] {
  const common = {
    wallet: input.wallet, projectId: input.projectId, runId: input.runId,
    traceId: input.traceId, occurredAt: input.occurredAt, source: "tools" as const,
    actor: { type: "agent" as const, id: input.agentId },
    subject: { type: "task" as const, id: input.taskId, label: input.taskName },
    visibility: "project" as const, attempt: input.attempt,
  };
  const events: ExecutionEventDraft[] = [];
  if (input.nextStatus !== input.currentStatus) {
    if (input.nextStatus === "In progress") events.push({
      ...common, type: "task.started", spanId: `task:${input.taskId}:attempt:${input.attempt}`,
      status: "running", dedupeKey: `task:${input.taskId}:attempt:${input.attempt}:started`,
      payload: { taskId: input.taskId, assigneeId: input.agentId },
    });
    else if (input.nextStatus === "Review") events.push({
      ...common, type: "task.review_requested", spanId: `task:${input.taskId}:attempt:${input.attempt}:review`,
      parentSpanId: `task:${input.taskId}:attempt:${input.attempt}`, status: "waiting",
      dedupeKey: `task:${input.taskId}:attempt:${input.attempt}:review-requested`,
      payload: { taskId: input.taskId, assigneeId: input.agentId },
    });
    else if (input.nextStatus === "Done") events.push({
      ...common, type: "task.completed", spanId: `task:${input.taskId}:attempt:${input.attempt}`,
      status: "succeeded", dedupeKey: `task:${input.taskId}:attempt:${input.attempt}:completed`,
      payload: { taskId: input.taskId, assigneeId: input.agentId },
    });
  }
  input.proof?.forEach((proof, index) => events.push({
    ...common, type: "proof.recorded", spanId: `task:${input.taskId}:attempt:${input.attempt}:proof:${index}`,
    parentSpanId: `task:${input.taskId}:attempt:${input.attempt}`,
    status: proof.status === "failed" ? "failed" : "succeeded",
    dedupeKey: `task:${input.taskId}:attempt:${input.attempt}:proof:${index}:${proof.status}`,
    payload: { taskId: input.taskId, proofType: proof.status, summary: proof.label?.slice(0, 500) },
  }));
  return events;
}

export async function enqueueExecutionEvents(
  tx: Transaction,
  projectRef: DocumentReference,
  drafts: readonly [ExecutionEventDraft, ...ExecutionEventDraft[]],
): Promise<void> {
  const first = drafts[0];
  const runRef = projectRef.collection("executionRuns").doc(first.runId);
  const rows = drafts.map((draft) => ({ draft, eventId: executionEventId(draft.runId, draft.dedupeKey) }));
  const outboxRefs = rows.map(({ eventId }) => db().collection("execution_event_outbox").doc(eventId));
  const [runSnap, ...outboxSnaps] = await Promise.all([tx.get(runRef), ...outboxRefs.map((ref) => tx.get(ref))]);
  let sequence = runSnap.exists && typeof runSnap.data()?.lastSequence === "number"
    ? Number(runSnap.data()?.lastSequence) + 1 : 0;
  const created = rows.flatMap(({ draft, eventId }, index) => {
    if (outboxSnaps[index]?.exists) return [];
    const event = ExecutionEventV1Schema.parse(removeUndefined({
      ...draft, schemaVersion: 1, eventId, sequence: sequence++, recordedAt: new Date().toISOString(),
    }));
    return [{ event, ref: outboxRefs[index]! }];
  });
  if (created.length === 0) return;
  tx.set(runRef, {
    runId: first.runId, projectId: first.projectId, rootTraceId: first.traceId,
    status: created.at(-1)!.event.status ?? "running", lastSequence: created.at(-1)!.event.sequence,
    eventCount: FieldValue.increment(created.length),
    startedAt: runSnap.exists ? (runSnap.data()?.startedAt ?? first.occurredAt) : first.occurredAt,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  created.forEach(({ event, ref }) => tx.create(ref, {
    event, wallet: event.wallet.toLowerCase(), projectId: event.projectId, runId: event.runId,
    state: "pending", attempts: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }));
}
