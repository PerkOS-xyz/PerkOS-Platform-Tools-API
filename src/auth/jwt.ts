/**
 * JWT auth — HS256, shared secret with the perkos-a2a-bridge.
 *
 * Bridge mints a short-lived token per chat_deliver frame with:
 *   { wallet: "0x...",
 *     convId: "assistant-0x...",
 *     role: "user" | "admin",
 *     requestId: "uuid",
 *     iat: <epoch>,
 *     exp: <iat + 30s> }
 *
 * Tools API validates the token before processing any tool call. The
 * wallet + role come from the JWT, NEVER from the request body —
 * which is the entire point of doing this server-side.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "../config.js";

export type TokenClaims = {
  wallet: string;
  /**
   * WHO acted, when the caller is an agent rather than a person.
   *
   * `wallet` is the BOARD's owner: for an invited agent it is the human's
   * wallet, so it cannot tell the agent's actions apart from the human's, and
   * a leaked agent credential reads as the owner. Optional because tokens
   * minted before this claim existed must keep verifying — the checks below
   * are by type and ignore extras.
   */
  agent?: string;
  convId: string;
  role: "user" | "admin";
  requestId: string;
  iat: number;
  exp: number;
};

type VerifyResult =
  | { ok: true; claims: TokenClaims }
  | { ok: false; reason: string };

function base64UrlDecode(input: string): Buffer {
  // JWT uses URL-safe base64 without padding; restore for Node's Buffer.
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(
    input.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  );
}

function base64UrlEncode(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sign(payloadB64: string, headerB64: string): string {
  return base64UrlEncode(
    createHmac("sha256", config.JWT_SHARED_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest(),
  );
}

/**
 * Verify + decode a JWT. Pure function — no I/O, no side effects.
 * Validates: signature (HMAC), expiration, claim shape.
 */
export function verifyToken(token: string): VerifyResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "empty token" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed token (expected 3 parts)" };
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // Verify signature first (constant-time) to avoid leaking payload
  // shape to attackers via parse-error timing differences.
  const expectedSig = sign(payloadB64, headerB64);
  const expectedBuf = Buffer.from(expectedSig);
  const actualBuf = Buffer.from(signatureB64);
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { ok: false, reason: "bad signature" };
  }

  // Header — only confirm alg is what we expect.
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad header json" };
  }
  if (header.alg !== "HS256") {
    return { ok: false, reason: `unsupported alg ${header.alg}` };
  }

  // Payload.
  let payload: Partial<TokenClaims>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad payload json" };
  }

  // Shape check.
  if (
    typeof payload.wallet !== "string" ||
    !/^0x[a-f0-9]{40}$/i.test(payload.wallet) ||
    typeof payload.convId !== "string" ||
    typeof payload.role !== "string" ||
    !["user", "admin"].includes(payload.role) ||
    typeof payload.requestId !== "string" ||
    (payload.agent !== undefined && typeof payload.agent !== "string") ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "claims missing or malformed" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec >= payload.exp) {
    return { ok: false, reason: "token expired" };
  }

  // Sanity: token max-age enforcement (defense-in-depth in case the
  // bridge mints a too-long-lived token by mistake).
  if (payload.exp - payload.iat > config.JWT_MAX_AGE_SECONDS) {
    return { ok: false, reason: "token max age exceeded" };
  }

  return {
    ok: true,
    claims: {
      wallet: payload.wallet.toLowerCase(),
      convId: payload.convId,
      role: payload.role as "user" | "admin",
      requestId: payload.requestId,
      // Absent on tokens minted before the claim existed.
      ...(typeof payload.agent === "string" && payload.agent
        ? { agent: payload.agent }
        : {}),
      iat: payload.iat,
      exp: payload.exp,
    },
  };
}

/**
 * Mint a token. Used by tests and by the bridge (when we import this
 * package or replicate the format in the bridge's bridge-agent code).
 */
export function signToken(
  claims: Omit<TokenClaims, "iat" | "exp">,
  ttlSeconds = 30,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const header = base64UrlEncode(
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload = base64UrlEncode(
    Buffer.from(JSON.stringify({ ...claims, iat, exp })),
  );
  const signature = sign(payload, header);
  return `${header}.${payload}.${signature}`;
}
