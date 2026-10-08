import { describe, expect, it } from "vitest";

import { claimStillHeld } from "../src/tools/claimGuard.js";

describe("claimStillHeld", () => {
  it("lets a board MCP call without a token commit while its claim is unchanged", () => {
    expect(claimStillHeld({ claimActive: true, checkedToken: "c1", latestToken: "c1" })).toBe(true);
  });

  it("stops a call without a token when the claim moved to another worker meanwhile", () => {
    expect(claimStillHeld({ claimActive: true, checkedToken: "c1", latestToken: "c2" })).toBe(false);
  });

  it("requires a worker that sends its token to hold the current claim", () => {
    expect(claimStillHeld({ claimActive: true, checkedToken: "c1", latestToken: "c1", argsToken: "c1" })).toBe(true);
    expect(claimStillHeld({ claimActive: true, checkedToken: "c1", latestToken: "c2", argsToken: "c1" })).toBe(false);
  });

  it("does not check anything when the task had no active claim", () => {
    expect(claimStillHeld({ claimActive: false, latestToken: "c9" })).toBe(true);
  });
});
