import { describe, expect, it, vi } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "test-key";
process.env.JWT_SHARED_SECRET = "test-secret-that-is-long-enough-for-validation";

vi.mock("../src/firestore.js", () => ({
  db: () => ({ collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }) }),
}));

const { buildTaskStatusEvents, enqueueExecutionEvents, executionEventId } = await import("../src/executionEvents.js");

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

describe("execution event outbox wallet", () => {
  async function outboxWallets(wallet: string): Promise<unknown[]> {
    const created: Record<string, unknown>[] = [];
    const tx = {
      get: async () => ({ exists: false, data: () => undefined }),
      set: () => tx,
      create: (_ref: unknown, data: Record<string, unknown>) => { created.push(data); return tx; },
    };
    const projectRef = { collection: (name: string) => ({ doc: (id: string) => ({ path: `project/${name}/${id}` }) }) };
    const drafts = buildTaskStatusEvents({ ...base, wallet });
    await enqueueExecutionEvents(tx as never, projectRef as never, drafts as [typeof drafts[0], ...typeof drafts]);
    return created.map((row) => row.wallet);
  }

  it("keeps a Solana owner's exact case", async () => {
    const solana = "So11111111111111111111111111111111111111112";
    expect(await outboxWallets(solana)).toEqual([solana]);
  });
  it("lowercases an EVM owner", async () => {
    expect(await outboxWallets(`0x${"AB".repeat(20)}`)).toEqual([`0x${"ab".repeat(20)}`]);
  });
});
