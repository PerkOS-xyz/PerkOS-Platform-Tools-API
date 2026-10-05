import { describe, expect, it } from "vitest";

import {
  dispatchStateForStatus,
  isPlaceholderResult,
  isTerminalTaskTransition,
  refreshesClaim,
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

describe("refreshesClaim", () => {
  it("keeps the claim alive while the holder is still working", () => {
    expect(refreshesClaim("In progress", true)).toBe(true);
    expect(refreshesClaim("Backlog", true)).toBe(true);
  });

  it.each(["Done", "Review"])("releases instead of refreshing on %s", (status) => {
    expect(refreshesClaim(status, true)).toBe(false);
  });

  it("never refreshes for a caller that does not hold the claim", () => {
    expect(refreshesClaim("In progress", false)).toBe(false);
  });
});

describe("isPlaceholderResult", () => {
  it.each(["done", "Done.", "  DONE!  ", "Completed", "Task complete.", "The task is done", "ok", "", "   "])(
    "rejects %j as a finishing result",
    (text) => {
      expect(isPlaceholderResult(text)).toBe(true);
    },
  );

  it.each([
    "## FAQ\n\n1. Does it have caffeine? Yes, black tea has about 40 mg.",
    "Done: three product pages are below.\n\n### Autumn Spice Chai",
    "Posted the launch email to the list and attached the copy.",
  ])("accepts a real deliverable", (text) => {
    expect(isPlaceholderResult(text)).toBe(false);
  });
});
