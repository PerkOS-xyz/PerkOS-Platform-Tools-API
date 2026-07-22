import { describe, expect, it } from "vitest";

import {
  dispatchStateForStatus,
  isTerminalTaskTransition,
} from "../src/tools/taskStatusPolicy.js";

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

describe("dispatchStateForStatus", () => {
  it("maps worker status updates to stable user-facing progress states", () => {
    expect(dispatchStateForStatus("Backlog")).toBe("queued");
    expect(dispatchStateForStatus("In progress")).toBe("working");
    expect(dispatchStateForStatus("Review")).toBe("review");
    expect(dispatchStateForStatus("Done")).toBe("completed");
  });
});
