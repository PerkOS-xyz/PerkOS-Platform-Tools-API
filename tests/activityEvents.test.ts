/**
 * activityEvents — events appended by worker tool calls for the mini-app's
 * dashboard feed. Contract: one doc per event under
 * /wallets/{wallet}/activity_events, EVM lowercase / Solana exact, undefined/empty
 * fields stripped, and the helper NEVER throws (logging must not break the
 * tool call it decorates).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const addMock = vi.fn(async () => ({ id: "ev1" }));
let pathParts: string[] = [];

vi.mock("../src/firestore.js", () => ({
  db: () => ({
    collection: (c: string) => {
      pathParts = [c];
      return {
        doc: (d: string) => {
          pathParts.push(d);
          return {
            collection: (c2: string) => {
              pathParts.push(c2);
              return { add: addMock };
            },
          };
        },
      };
    },
  }),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "TS" },
}));

const { logActivity } = await import("../src/activityEvents.js");

beforeEach(() => {
  addMock.mockClear();
  pathParts = [];
});

describe("logActivity", () => {
  it("keeps case-distinct Solana activity in separate paths", () => {
    for (const wallet of ["So11111111111111111111111111111111111111112", "so11111111111111111111111111111111111111112"]) {
      logActivity(wallet, { actorType: "agent", actor: "fixture", verb: "completed_task", object: "fixture" });
      expect(pathParts).toEqual(["wallets", wallet, "activity_events"]);
    }
  });
  it("writes under the lowercased wallet with stamped ts", () => {
    logActivity(`0x${"Ab".repeat(20)}`, {
      actorType: "agent",
      actor: "Maya",
      verb: "completed_task",
      object: "Write copy",
      projectId: "p1",
      taskId: "t1",
    });
    expect(pathParts).toEqual(["wallets", `0x${"ab".repeat(20)}`, "activity_events"]);
    expect(addMock.mock.calls[0]![0]).toEqual({
      actorType: "agent",
      actor: "Maya",
      verb: "completed_task",
      object: "Write copy",
      projectId: "p1",
      taskId: "t1",
      ts: "TS",
    });
  });

  it("strips undefined and empty-string fields", () => {
    logActivity("0xabc", {
      actorType: "agent",
      actor: "PM",
      verb: "proposed_plan",
      object: "3 tasks",
      detail: undefined,
      taskId: "",
    });
    const payload = addMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("detail");
    expect(payload).not.toHaveProperty("taskId");
  });

  it("is a no-op without a wallet and never throws on backend errors", async () => {
    logActivity("", {
      actorType: "agent",
      actor: "Maya",
      verb: "created_task",
      object: "x",
    });
    expect(addMock).not.toHaveBeenCalled();

    addMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() =>
      logActivity("0xabc", {
        actorType: "agent",
        actor: "Maya",
        verb: "created_task",
        object: "x",
      }),
    ).not.toThrow();

    addMock.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    expect(() =>
      logActivity("0xabc", {
        actorType: "agent",
        actor: "Maya",
        verb: "created_task",
        object: "x",
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
