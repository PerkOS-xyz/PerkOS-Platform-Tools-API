import { describe, expect, it } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);

const { planProposalDecision } = await import("../src/tools/proposePlan.js");
const { normalizedPlanLabel } = await import("../src/tools/docShared.js");
const { planningRunDecision } = await import("../src/tools/planningRun.js");

describe("plan proposal policy", () => {
  it("makes a repeated proposal for the same pending revision idempotent", () => {
    expect(
      planProposalDecision(
        { phase: "awaiting_approval", planId: "plan-1" },
        "plan_proposed",
        "plan-1",
      ),
    ).toBe("idempotent");
  });

  it("rejects proposals after approved work starts", () => {
    for (const phase of ["running", "pm_review", "complete"]) {
      expect(planProposalDecision({ phase }, "under_discussion", "plan-1")).toBe("conflict");
    }
  });

  it("allows a revised draft to be proposed once", () => {
    expect(
      planProposalDecision({ phase: "planning", planId: "plan-1" }, "under_discussion", "plan-1"),
    ).toBe("propose");
  });
});

describe("planning run ownership", () => {
  const workflow = {
    phase: "planning",
    planningRunId: "b4ed66d0-c1ef-4ae1-9524-54dca0bb571b",
  };

  it("requires and validates the token while planning", () => {
    expect(planningRunDecision(workflow, undefined)).toBe("missing");
    expect(planningRunDecision(workflow, "7f9eca90-4f27-49b2-8d40-9dcf81883984")).toBe("stale");
    expect(planningRunDecision(workflow, workflow.planningRunId)).toBe("allow");
  });

  it("does not affect non-planning document work", () => {
    expect(planningRunDecision({ phase: "running", planningRunId: workflow.planningRunId }, undefined)).toBe("allow");
  });
});

describe("normalizedPlanLabel", () => {
  it("collapses cosmetic differences used by retrying PM calls", () => {
    expect(normalizedPlanLabel("  Final   Synthesis ")).toBe("final synthesis");
  });
});
