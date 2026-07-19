import { describe, expect, it } from "vitest";

import { isTerminalTaskTransition } from "../src/tools/taskStatusPolicy.js";

describe("isTerminalTaskTransition", () => {
  it.each(["Backlog", "In progress", "Review"])(
    "blocks Done → %s",
    (requested) => {
      expect(isTerminalTaskTransition("Done", requested)).toBe(true);
    },
  );

  it("allows idempotent completion and normal forward movement", () => {
    expect(isTerminalTaskTransition("Done", "Done")).toBe(false);
    expect(isTerminalTaskTransition("In progress", "Done")).toBe(false);
  });
});
