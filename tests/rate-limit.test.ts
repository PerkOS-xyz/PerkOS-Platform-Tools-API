import { afterEach, beforeAll, describe, expect, it } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);
process.env.RATE_LIMIT_READ_PER_MIN = "5";
process.env.RATE_LIMIT_ACTION_PER_MIN = "2";

const { check, reset, snapshot } = await import("../src/rate-limit.js");

describe("rate-limit", () => {
  afterEach(() => reset());

  const wallet = "0x" + "a".repeat(40);

  it("allows up to RATE_LIMIT_READ_PER_MIN read calls then denies", () => {
    for (let i = 0; i < 5; i++) expect(check(wallet, "read")).toBe(true);
    expect(check(wallet, "read")).toBe(false);
  });

  it("tracks read + action buckets independently", () => {
    for (let i = 0; i < 5; i++) expect(check(wallet, "read")).toBe(true);
    expect(check(wallet, "action")).toBe(true);
    expect(check(wallet, "action")).toBe(true);
    expect(check(wallet, "action")).toBe(false);
  });

  it("tracks wallets independently", () => {
    const w2 = "0x" + "b".repeat(40);
    for (let i = 0; i < 5; i++) check(wallet, "read");
    expect(check(wallet, "read")).toBe(false);
    expect(check(w2, "read")).toBe(true);
  });

  it("snapshot exposes remaining tokens", () => {
    check(wallet, "read");
    check(wallet, "read");
    const s = snapshot(wallet);
    expect(s?.read).toBe(3); // 5 cap - 2 consumed
    expect(s?.action).toBe(2);
  });
});
