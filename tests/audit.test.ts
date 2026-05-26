import { describe, expect, it } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);

const { redactArgs } = await import("../src/audit.js");

describe("audit.redactArgs", () => {
  it("redacts string lengths instead of contents (no PII leak)", () => {
    const out = redactArgs({ topic: "secret-topic", limit: 10 });
    expect(out.topic).toBe("string(12)");
    expect(out.limit).toBe("number");
    expect(JSON.stringify(out)).not.toContain("secret-topic");
  });

  it("handles arrays + objects via type tags only", () => {
    const out = redactArgs({ tags: ["a", "b", "c"], opts: { foo: 1 } });
    expect(out.tags).toBe("array(3)");
    expect(out.opts).toBe("object(1)");
  });

  it("returns empty object for non-object input", () => {
    expect(redactArgs("a string")).toEqual({});
    expect(redactArgs(null)).toEqual({});
    expect(redactArgs(42)).toEqual({});
  });

  it("handles null values", () => {
    expect(redactArgs({ before: null, limit: 5 })).toEqual({
      before: "null",
      limit: "number",
    });
  });
});
