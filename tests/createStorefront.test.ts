/**
 * createStorefront — request shape, payout wallet rules, and the AgentWired
 * call, with fetch stubbed so the test never leaves the machine.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);
process.env.AGENTWIRED_URL = "https://agentwired.test";
process.env.AGENTWIRED_SERVICE_TOKEN = "service-token-for-tests";

const { buildStorefrontRequest, createStorefront, looksLikeSolanaAddress, storefrontExternalId } =
  await import("../src/tools/createStorefront.js");

const SOLANA = "BgW3xVRcWuBiGTFAoHdtJuekQNFQfoJ6GuDV9TJqSa1m";
const EVM = "0x1111111111111111111111111111111111111111";
const ctx = (wallet: string) => ({ wallet, convId: "conv-1" }) as never;
const args = {
  name: "Harbor & Pine Coffee",
  vertical: "Food",
  description: "Small-batch coffee for everyday rituals.",
  items: [{ name: "Espresso Shot", price: 1 }],
};

afterEach(() => vi.unstubAllGlobals());

describe("createStorefront helpers", () => {
  it("recognises Solana addresses and rejects EVM ones", () => {
    expect(looksLikeSolanaAddress(SOLANA)).toBe(true);
    expect(looksLikeSolanaAddress(EVM)).toBe(false);
  });

  it("keys the store to the owner and the business name", () => {
    expect(storefrontExternalId(SOLANA, "Harbor & Pine Coffee")).toBe(`perkos:${SOLANA}:harbor-pine-coffee`);
  });

  it("publishes with USDC on Solana to the given wallet", () => {
    const body = buildStorefrontRequest({ ...args, solanaWallet: undefined }, EVM, SOLANA);
    expect(body.publish).toBe(true);
    expect(body.ownerUserId).toBe(`perkos:${EVM}`);
    expect(body.vertical).toBe("food");
    expect(body.paymentMethods).toEqual([
      { provider: "crypto", network: "solana", asset: "USDC", recipient: SOLANA, enabled: true },
    ]);
  });
});

describe("createStorefront.run", () => {
  it("asks for a Solana wallet when the owner signed in with an EVM one", async () => {
    const result = await createStorefront.run({ args: { ...args, solanaWallet: undefined }, ctx: ctx(EVM) });
    expect(result).toMatchObject({ ok: false, errorClass: "BAD_INPUT" });
  });

  it("returns the live store link from AgentWired", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          store: {
            name: "Harbor & Pine Coffee",
            status: "published",
            storeUrl: "https://harbor-pine-coffee-abc123.agentwired.test",
            catalogUrl: "https://harbor-pine-coffee-abc123.agentwired.test/catalog",
            tenantId: "harbor-pine-coffee-abc123",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await createStorefront.run({ args: { ...args, solanaWallet: undefined }, ctx: ctx(SOLANA) });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "published", storeUrl: "https://harbor-pine-coffee-abc123.agentwired.test", recipient: SOLANA },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agentwired.test/api/integrations/perkos/stores");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer service-token-for-tests");
  });

  it("passes AgentWired's error back to the agent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "at least one item is required" }), { status: 400 })));
    const result = await createStorefront.run({ args: { ...args, solanaWallet: SOLANA }, ctx: ctx(EVM) });
    expect(result).toMatchObject({ ok: false, errorClass: "BAD_INPUT", message: "at least one item is required" });
  });
});
