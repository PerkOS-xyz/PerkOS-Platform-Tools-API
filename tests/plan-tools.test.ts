/**
 * Plan-doc tools — hermetic checks that don't touch Firestore.
 *
 * The run() handlers read/write Firestore (covered by manual integration
 * smoke, like createTask). Here we assert registration + the input-schema
 * contracts (kind/role, required fields, strict rejection of junk).
 */

import { describe, expect, it } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);
process.env.AUDIT_ENABLED = "false";

const { findTool } = await import("../src/tools/index.js");

describe("docs-workspace tool registration", () => {
  it("registers all docs tools", () => {
    for (const name of [
      "listDocs",
      "createDoc",
      "readDoc",
      "upsertPlanGroup",
      "upsertPlanTask",
      "proposePlan",
      "postDocMessage",
    ]) {
      expect(findTool(name), name).not.toBeNull();
    }
  });

  it("reads are read tools; the rest are actions", () => {
    expect(findTool("listDocs")?.kind).toBe("read");
    expect(findTool("readDoc")?.kind).toBe("read");
    expect(findTool("createDoc")?.kind).toBe("action");
    expect(findTool("upsertPlanGroup")?.kind).toBe("action");
    expect(findTool("upsertPlanTask")?.kind).toBe("action");
    expect(findTool("proposePlan")?.kind).toBe("action");
    expect(findTool("postDocMessage")?.kind).toBe("action");
  });
});

describe("plan-doc input schemas", () => {
  it("upsertPlanGroup requires projectId + title, rejects extras", () => {
    const t = findTool("upsertPlanGroup")!;
    expect(t.input.safeParse({ projectId: "p1", title: "Sprint 1" }).success).toBe(true);
    expect(t.input.safeParse({ projectId: "p1" }).success).toBe(false);
    expect(
      t.input.safeParse({ projectId: "p1", title: "x", bogus: 1 }).success,
    ).toBe(false);
  });

  it("upsertPlanTask requires groupId + title", () => {
    const t = findTool("upsertPlanTask")!;
    expect(
      t.input.safeParse({ projectId: "p1", groupId: "g1", title: "Do X" }).success,
    ).toBe(true);
    // missing groupId
    expect(t.input.safeParse({ projectId: "p1", title: "Do X" }).success).toBe(false);
  });

  it("createDoc requires a valid type", () => {
    const t = findTool("createDoc")!;
    expect(
      t.input.safeParse({ projectId: "p1", type: "note", title: "Spec" }).success,
    ).toBe(true);
    expect(
      t.input.safeParse({ projectId: "p1", type: "bogus", title: "x" }).success,
    ).toBe(false);
  });

  it("rejects malformed projectId", () => {
    const t = findTool("readDoc")!;
    expect(t.input.safeParse({ projectId: "bad id!" }).success).toBe(false);
    expect(t.input.safeParse({ projectId: "ok-id_1" }).success).toBe(true);
  });
});
