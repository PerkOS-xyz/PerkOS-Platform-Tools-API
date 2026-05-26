import { describe, expect, it, beforeAll } from "vitest";

// Set required env BEFORE importing the modules so config validation passes.
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----";
process.env.JWT_SHARED_SECRET = "a".repeat(40);

const { signToken, verifyToken } = await import("../src/auth/jwt.js");

describe("jwt", () => {
  const claims = {
    wallet: "0x" + "a".repeat(40),
    convId: "assistant-0xabc",
    role: "user" as const,
    requestId: "req-1",
  };

  it("round-trips a valid token", () => {
    const tok = signToken(claims);
    const r = verifyToken(tok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.wallet).toBe(claims.wallet.toLowerCase());
      expect(r.claims.role).toBe("user");
    }
  });

  it("rejects malformed tokens", () => {
    expect(verifyToken("garbage").ok).toBe(false);
    expect(verifyToken("a.b").ok).toBe(false);
    expect(verifyToken("").ok).toBe(false);
  });

  it("rejects bad signature", () => {
    const tok = signToken(claims);
    const tampered = tok.slice(0, -3) + "xxx";
    const r = verifyToken(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("signature");
  });

  it("rejects expired tokens", () => {
    const tok = signToken(claims, 0); // exp = now → already expired
    // Sleep one ms to push us past exp.
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        const r = verifyToken(tok);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("expired");
        resolve();
      }, 1100), // exp is in whole seconds; wait > 1s
    );
  });

  it("rejects wrong-shaped claims", () => {
    // Sign a token with bad wallet shape — verify rejects on shape check.
    const bad = signToken({
      ...claims,
      wallet: "not-a-wallet" as string,
    });
    const r = verifyToken(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects unsupported alg headers", () => {
    // Hand-craft a token with alg:none to confirm the verifier insists on HS256.
    const enc = (s: string) =>
      Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const header = enc(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = enc(
      JSON.stringify({
        ...claims,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30,
      }),
    );
    // Even with the right signature shape (empty), the alg check should fail.
    const r = verifyToken(`${header}.${payload}.`);
    expect(r.ok).toBe(false);
  });
});
