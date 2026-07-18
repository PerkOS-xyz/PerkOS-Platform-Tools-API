/**
 * Pure-input tool tests — the ones that don't touch Firestore.
 *
 * getRunbookFor + searchKnowledge + explainPlugin all read from the
 * local filesystem. We point RUNBOOK_DIR + PLUGIN_CATALOG_PATH at the
 * repo's bundled fixtures (./runbook/, ./plugins/catalog.json) so the
 * tests are hermetic — no network, no live Firestore.
 *
 * listMyAgents + getMyAgent need Firestore; covered by integration
 * smoke (manual; out of scope for CI without an emulator).
 */

import { describe, expect, it } from "vitest";
import path from "node:path";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);
process.env.RUNBOOK_DIR = path.resolve(__dirname, "..", "runbook");
process.env.PLUGIN_CATALOG_PATH = path.resolve(
  __dirname,
  "..",
  "plugins",
  "catalog.json",
);
process.env.AUDIT_ENABLED = "false";

const { getRunbookFor } = await import("../src/tools/getRunbookFor.js");
const { searchKnowledge } = await import("../src/tools/searchKnowledge.js");
const { explainPlugin } = await import("../src/tools/explainPlugin.js");
const { redactClaimTokens } = await import("../src/tools/outputSanitizer.js");

const ctx = {
  wallet: "0x" + "a".repeat(40),
  convId: "assistant-0xa",
  role: "user" as const,
  requestId: "req-1",
  iat: 0,
  exp: 9_999_999_999,
};

describe("getRunbookFor", () => {
  it("returns markdown for a known topic (by full slug)", async () => {
    const r = await getRunbookFor.run({
      args: { topic: "00-platform-overview" },
      ctx,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as { content: string }).content).toContain("PerkOS");
    }
  });

  it("matches by stem (numeric prefix stripped)", async () => {
    const r = await getRunbookFor.run({
      args: { topic: "deploy-modes" },
      ctx,
    });
    expect(r.ok).toBe(true);
  });

  it("returns NOT_FOUND for unknown topic with available list", async () => {
    const r = await getRunbookFor.run({
      args: { topic: "nonexistent" },
      ctx,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorClass).toBe("NOT_FOUND");
      expect(r.message).toContain("Available");
    }
  });
});

describe("searchKnowledge", () => {
  it("ranks hits by keyword overlap", async () => {
    const r = await searchKnowledge.run({
      args: { query: "fargate ecs deploy", limit: 5 },
      ctx,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const hits = (r.data as { hits: Array<{ topic: string }> }).hits;
      expect(hits.length).toBeGreaterThan(0);
      // The deploy-modes entry should rank near the top for "fargate ecs".
      expect(hits[0]?.topic).toMatch(/deploy/);
    }
  });

  it("returns empty hits for unmatched query (no junk)", async () => {
    const r = await searchKnowledge.run({
      args: { query: "asdfqwertyzzxcvb", limit: 5 },
      ctx,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as { hits: unknown[] }).hits).toHaveLength(0);
    }
  });

  it("respects limit", async () => {
    const r = await searchKnowledge.run({
      args: { query: "perkos agent", limit: 2 },
      ctx,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as { hits: unknown[] }).hits.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("explainPlugin", () => {
  it("returns details for a known plugin id", async () => {
    const r = await explainPlugin.run({
      args: { pluginId: "github" },
      ctx,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const p = r.data as { id: string; label: string };
      expect(p.id).toBe("github");
      expect(p.label.toLowerCase()).toContain("github");
    }
  });

  it("returns NOT_FOUND for unknown plugin", async () => {
    const r = await explainPlugin.run({
      args: { pluginId: "imaginary" },
      ctx,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorClass).toBe("NOT_FOUND");
  });
});

describe("redactClaimTokens", () => {
  it("removes claim credentials from persisted user content", () => {
    expect(
      redactClaimTokens(
        "done — roadmap delivered; claimToken=617b2ada-bf27-4665-8393-c31d47d1e151",
      ),
    ).toBe("done — roadmap delivered; claimToken=[redacted]");
  });
});
