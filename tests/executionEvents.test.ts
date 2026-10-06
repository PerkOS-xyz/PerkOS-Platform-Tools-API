import { describe, expect, it } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "test-key";
process.env.JWT_SHARED_SECRET = "test-secret-that-is-long-enough-for-validation";

const { buildTaskStatusEvents, executionEventId } = await import("../src/executionEvents.js");

const base = {
  wallet: "0xabc", projectId: "project-1", taskId: "task-1", taskName: "Create campaign",
  agentId: "Campaign Lead", runId: "run-1", traceId: "trace-1", attempt: 1,
  currentStatus: "Backlog", nextStatus: "In progress", goalMode: false,
  occurredAt: "2026-10-07T03:00:00.000Z",
};

describe("canonical task status events", () => {
  it("emits one start event for a real transition", () => {
    expect(buildTaskStatusEvents(base).map((event) => event.type)).toEqual(["task.started"]);
  });
  it("does not turn a heartbeat into a visual event", () => {
    expect(buildTaskStatusEvents({ ...base, currentStatus: "In progress", nextStatus: "In progress" })).toEqual([]);
  });
  it("emits review and safe proof summaries", () => {
    const events = buildTaskStatusEvents({
      ...base, currentStatus: "In progress", nextStatus: "Review", goalMode: true,
      proof: [{ status: "passed", label: "Visual regression passed" }],
    });
    expect(events.map((event) => event.type)).toEqual(["task.review_requested", "proof.recorded"]);
    expect(JSON.stringify(events)).not.toContain("command");
    expect(JSON.stringify(events)).not.toContain("url");
  });
  it("creates stable ids per run and transition", () => {
    expect(executionEventId("run-1", "task:1:started")).toBe(executionEventId("run-1", "task:1:started"));
  });
});
