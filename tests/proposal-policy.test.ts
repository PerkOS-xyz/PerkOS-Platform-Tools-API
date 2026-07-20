import { describe, expect, it } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);

const { planProposalDecision } = await import("../src/tools/proposePlan.js");
const { normalizedPlanLabel } = await import("../src/tools/docShared.js");

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

describe("normalizedPlanLabel", () => {
  it("collapses cosmetic differences used by retrying PM calls", () => {
    expect(normalizedPlanLabel("  Final   Synthesis ")).toBe("final synthesis");
  });
});
