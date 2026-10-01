import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "fake";
process.env.JWT_SHARED_SECRET = "a".repeat(40);
delete process.env.PERKOS_SOLANA_LOGIN_ENABLED;

const { config } = await import("../src/config.js");
const { signToken, verifyToken } = await import("../src/auth/jwt.js");
const { check, reset } = await import("../src/rate-limit.js");
const wallet = "So11111111111111111111111111111111111111112";
const other = "so11111111111111111111111111111111111111112";
const base = { wallet, walletChain: "solana" as const, role: "user" as const, convId: "fixture-conversation", requestId: "fixture-request" };

const { paths, store } = vi.hoisted(() => ({ paths: [] as string[], store: new Map<string, Record<string, unknown>>() }));
vi.mock("../src/firestore.js", () => {
  const ref = (path: string) => ({
    collection: (name: string) => ref(`${path}/${name}`),
    doc: (name: string) => ref(`${path}/${name}`),
    get: async () => { paths.push(path); return { exists: store.has(path), data: () => store.get(path) }; },
  });
  return { db: () => ref("") };
});
const { getMyAgent } = await import("../src/tools/getMyAgent.js");

beforeEach(() => { config.PERKOS_SOLANA_LOGIN_ENABLED = false; paths.length = 0; store.clear(); reset(); });

describe("Solana tool identity", () => {
  it("is disabled by default", () => {
    expect(config.PERKOS_SOLANA_LOGIN_ENABLED).toBe(false);
    expect(verifyToken(signToken(base)).ok).toBe(false);
  });
  it("keeps exact case after signature verification", () => {
    config.PERKOS_SOLANA_LOGIN_ENABLED = true;
    for (const address of [wallet, other]) {
      const result = verifyToken(signToken({ ...base, wallet: address }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.claims).toMatchObject({ wallet: address, walletChain: "solana", role: "user" });
    }
  });
  it("requires an explicit matching chain and a valid public key", () => {
    config.PERKOS_SOLANA_LOGIN_ENABLED = true;
    expect(verifyToken(signToken({ ...base, walletChain: undefined })).ok).toBe(false);
    expect(verifyToken(signToken({ ...base, walletChain: "evm" })).ok).toBe(false);
    expect(verifyToken(signToken({ ...base, wallet: `0x${"ab".repeat(20)}` })).ok).toBe(false);
    expect(verifyToken(signToken({ ...base, wallet: "invalid/address" })).ok).toBe(false);
  });
  it("does not elevate Solana even with a signed admin role", () => {
    config.PERKOS_SOLANA_LOGIN_ENABLED = true;
    const result = verifyToken(signToken({ ...base, role: "admin" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.role).toBe("user");
  });
  it("preserves legacy mixed-case EVM tokens and roles without a chain claim", () => {
    const result = verifyToken(signToken({ ...base, wallet: `0x${"AB".repeat(20)}`, walletChain: undefined, role: "admin" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims).toMatchObject({ wallet: `0x${"ab".repeat(20)}`, role: "admin" });
  });
  it("keeps rate budgets separate for case-distinct identities", () => {
    for (let i = 0; i < config.RATE_LIMIT_READ_PER_MIN; i++) check(wallet, "read");
    expect(check(wallet, "read")).toBe(false);
    expect(check(other, "read")).toBe(true);
  });
  it("reads only the exact owner's agent subtree", async () => {
    store.set("/agents/fixture", { walletAddress: wallet, agentId: "fixture-id" });
    store.set(`/wallets/${wallet}/agents/fixture-id`, { runtime: "hermes" });
    const result = await getMyAgent.run({ args: { name: "fixture" }, ctx: { ...base, iat: 1, exp: 2 } });
    expect(result.ok).toBe(true);
    expect(paths).toEqual(["/agents/fixture", `/wallets/${wallet}/agents/fixture-id`]);
  });
  it("denies a different-case owner without reading its subtree", async () => {
    store.set("/agents/fixture", { walletAddress: other, agentId: "fixture-id" });
    const result = await getMyAgent.run({ args: { name: "fixture" }, ctx: { ...base, iat: 1, exp: 2 } });
    expect(result).toMatchObject({ ok: false, errorClass: "NOT_FOUND" });
    expect(paths).toEqual(["/agents/fixture"]);
  });
});
