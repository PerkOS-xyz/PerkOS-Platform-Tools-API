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

const { buildStorefrontRequest, createStorefront, looksLikeEvmAddress, looksLikeSolanaAddress, storefrontExternalId } =
  await import("../src/tools/createStorefront.js");

const SOLANA = "BgW3xVRcWuBiGTFAoHdtJuekQNFQfoJ6GuDV9TJqSa1m";
const EVM = "0x1111111111111111111111111111111111111111";
const ctx = (wallet: string) => ({ wallet, convId: "conv-1" }) as never;
const args = {
  name: "Harbor & Pine Coffee",
  vertical: "Food",
  description: "Small-batch coffee for everyday rituals.",
  items: [{
    name: "Espresso Shot",
    price: 1,
    category: "Drinks",
    imagePrompt: "editorial espresso on a stone counter",
  }],
  checkoutMode: "test" as const,
  paymentNetwork: "base" as const,
};

const taskContext = {
  projectId: "project-1",
  taskId: "task-1",
  claimToken: "claim-token-1234567890",
};

afterEach(() => vi.unstubAllGlobals());

describe("createStorefront helpers", () => {
  it("recognises Solana addresses and rejects EVM ones", () => {
    expect(looksLikeSolanaAddress(SOLANA)).toBe(true);
    expect(looksLikeSolanaAddress(EVM)).toBe(false);
    expect(looksLikeEvmAddress(EVM)).toBe(true);
    expect(looksLikeEvmAddress(SOLANA)).toBe(false);
  });

  it("keys the store to the owner and the business name", () => {
    expect(storefrontExternalId(SOLANA, "Harbor & Pine Coffee")).toBe(`perkos:${SOLANA}:harbor-pine-coffee`);
  });

  it("publishes with USDC on Solana to the given wallet", () => {
    const body = buildStorefrontRequest({ ...args, payoutWallet: undefined }, EVM, EVM);
    expect(body.publish).toBe(true);
    expect(body.ownerUserId).toBe(`perkos:${EVM}`);
    expect(body.vertical).toBe("food");
    expect(body.updateExisting).toBe(true);
    expect(body.items[0]).toMatchObject({
      category: "Drinks",
      imagePrompt: "editorial espresso on a stone counter",
    });
    expect(body.paymentMethods).toEqual([
      { provider: "crypto", network: "base", asset: "USDC", recipient: EVM, enabled: true },
    ]);
  });
});

describe("createStorefront.run", () => {
  it("asks for a Solana wallet only when live checkout is requested", async () => {
    const baseResult = await createStorefront.run({ args: { ...args, checkoutMode: "live", payoutWallet: undefined }, ctx: ctx(SOLANA) });
    expect(baseResult).toMatchObject({ ok: false, errorClass: "BAD_INPUT" });

    const solanaResult = await createStorefront.run({ args: { ...args, checkoutMode: "live", paymentNetwork: "solana", payoutWallet: undefined }, ctx: ctx(EVM) });
    expect(solanaResult).toMatchObject({ ok: false, errorClass: "BAD_INPUT" });
  });

  it("allows test checkout without a payout wallet", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ store: {
      name: args.name, status: "published", storeUrl: "https://store.test", catalogUrl: "https://store.test/catalog", tenantId: "store-1",
    } }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createStorefront.run({ args: { ...args, solanaWallet: undefined }, ctx: ctx(EVM) });
    expect(result).toMatchObject({ ok: true, data: { checkoutMode: "test", payments: "USDC checkout in test mode" } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ checkoutMode: "test", paymentMethods: [{ recipient: "" }] });
  });

  it("returns the published store link from AgentWired", async () => {
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
      data: { status: "published", storeUrl: "https://harbor-pine-coffee-abc123.agentwired.test", recipient: "" },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agentwired.test/api/integrations/perkos/stores");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer service-token-for-tests");
  });

  it("keeps assignment context out of the AgentWired request", () => {
    const body = buildStorefrontRequest({ ...args, taskContext }, EVM, "");
    expect(body).not.toHaveProperty("taskContext");
  });

  it("passes AgentWired's error back to the agent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "at least one item is required" }), { status: 400 })));
    const result = await createStorefront.run({ args: { ...args, solanaWallet: SOLANA }, ctx: ctx(EVM) });
    expect(result).toMatchObject({ ok: false, errorClass: "BAD_INPUT", message: "at least one item is required" });
  });
});
