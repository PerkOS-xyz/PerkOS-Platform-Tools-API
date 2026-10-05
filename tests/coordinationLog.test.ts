/**
 * coordinationLog — a worker's delivered result reaches the project
 * conversation. Contract: one entry per task at
 * /wallets/{wallet}/projects/{projectId}/coordination/result-{taskId}, Solana
 * wallets kept exact, text bounded and free of claim tokens, never throws.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const setMock = vi.fn(async () => undefined);
let pathParts: string[] = [];

vi.mock("../src/firestore.js", () => {
  const node = (): Record<string, unknown> => ({
    collection: (c: string) => {
      pathParts.push(c);
      return node();
    },
    doc: (d: string) => {
      pathParts.push(d);
      return node();
    },
    set: setMock,
  });
  return { db: () => { pathParts = []; return node(); } };
});

const { coordinationText, logDeliveredResult, resultEntryId, COORDINATION_TEXT_MAX } = await import(
  "../src/coordinationLog.js"
);

const SOLANA = "EsXvSde4oFup8d2QdbEMrA2YWjCod52SbECQ9dgJ6SLA";

describe("logDeliveredResult", () => {
  beforeEach(() => setMock.mockClear());

  it("writes one result entry per task under the exact Solana wallet", () => {
    logDeliveredResult(SOLANA, "proj1", { agent: "Writer", taskId: "task1", text: "## FAQ\n\nFive answers." });
    expect(pathParts).toEqual(["wallets", SOLANA, "projects", "proj1", "coordination", resultEntryId("task1")]);
    expect(setMock).toHaveBeenCalledTimes(1);
    const [entry] = setMock.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({ from: "agent:Writer", to: "sparky", kind: "result", taskId: "task1", ok: true });
    expect(entry.text).toBe("## FAQ\n\nFive answers.");
  });

  it("skips empty text and missing ids", () => {
    logDeliveredResult(SOLANA, "proj1", { agent: "Writer", taskId: "task1", text: "   " });
    logDeliveredResult(SOLANA, "", { agent: "Writer", taskId: "task1", text: "Result" });
    logDeliveredResult(SOLANA, "proj1", { agent: "Writer", taskId: "", text: "Result" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("never throws when Firestore rejects", () => {
    setMock.mockRejectedValueOnce(new Error("offline"));
    expect(() =>
      logDeliveredResult(SOLANA, "proj1", { agent: "Writer", taskId: "task1", text: "Result" }),
    ).not.toThrow();
  });
});

describe("coordinationText", () => {
  it("scrubs claim tokens and bounds the length", () => {
    const text = `claimToken: abcdefghijklmnop1234 ${"word ".repeat(400)}`;
    const clean = coordinationText(text);
    expect(clean).not.toContain("abcdefghijklmnop1234");
    expect(clean.length).toBeLessThanOrEqual(COORDINATION_TEXT_MAX);
    expect(clean.endsWith("…")).toBe(true);
  });
});
