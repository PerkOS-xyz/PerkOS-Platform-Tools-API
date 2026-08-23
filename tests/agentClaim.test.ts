import { describe, expect, it } from "vitest";

// Set required env BEFORE importing the modules so config validation passes.
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----";
process.env.JWT_SHARED_SECRET = "a".repeat(40);

const { signToken, verifyToken } = await import("../src/auth/jwt.js");

const WALLET = "0xc2564e41b7f5cb66d2d99466450cfebce9e8228f";

/**
 * `wallet` identifies the BOARD, not the caller. For an invited agent it is the
 * human owner's wallet, so without a separate claim every agent action is
 * indistinguishable from the owner's own — and a leaked agent credential
 * leaves no trace of which agent it impersonated.
 */
describe("agent claim", () => {
  it("round-trips the acting agent", () => {
    const token = signToken({
      wallet: WALLET,
      convId: "agent:Athena",
      role: "user",
      requestId: "req-1",
      agent: "Athena",
    });
    const result = verifyToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.agent).toBe("Athena");
  });

  it("still accepts tokens minted before the claim existed", () => {
    const token = signToken({
      wallet: WALLET,
      convId: `assistant-${WALLET}`,
      role: "user",
      requestId: "req-2",
    });
    const result = verifyToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.agent).toBeUndefined();
      expect(result.claims.wallet).toBe(WALLET);
    }
  });

  it("rejects a non-string agent instead of silently dropping it", () => {
    const token = signToken({
      wallet: WALLET,
      convId: "agent:Athena",
      role: "user",
      requestId: "req-3",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent: 42 as any,
    });
    expect(verifyToken(token).ok).toBe(false);
  });
});
