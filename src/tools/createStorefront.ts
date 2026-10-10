/**
 * createStorefront(name, vertical, description, items, solanaWallet?)
 *   → {name, status, storeUrl, catalogUrl, tenantId, payments, recipient}
 *
 * Builds and publishes an AgentWired storefront for the calling wallet's
 * business. Payments are USDC on Solana and go straight to the owner's
 * wallet; PerkOS never holds them. The store is keyed to the wallet and the
 * business name, so asking twice returns the same store instead of a second
 * one.
 */

import { z } from "zod";

import { config } from "../config.js";
import type { Tool } from "./types.js";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function looksLikeSolanaAddress(value: string): boolean {
  return SOLANA_ADDRESS.test(value);
}

/** Stable per owner and business name, so a retry reuses the same store. */
export function storefrontExternalId(wallet: string, name: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "store";
  return `perkos:${wallet}:${slug}`;
}

const ItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().min(0).max(100_000),
  description: z.string().trim().max(400).optional(),
});

const InputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  vertical: z.string().trim().min(2).max(40).default("other"),
  description: z.string().trim().max(1000).default(""),
  items: z.array(ItemSchema).min(1).max(20),
  solanaWallet: z.string().trim().optional(),
});

type Input = z.infer<typeof InputSchema>;

export function buildStorefrontRequest(args: Input, wallet: string, recipient: string) {
  return {
    externalId: storefrontExternalId(wallet, args.name),
    ownerUserId: `perkos:${wallet}`,
    name: args.name,
    vertical: args.vertical.toLowerCase(),
    description: args.description,
    items: args.items.map((item) => ({
      name: item.name,
      price: item.price,
      description: item.description ?? "",
    })),
    paymentMethods: [
      { provider: "crypto", network: "solana", asset: "USDC", recipient, enabled: true },
    ],
    publish: true,
  };
}

type StoreResponse = {
  store?: {
    name: string;
    status: string;
    storeUrl: string;
    catalogUrl: string;
    tenantId: string;
  };
  error?: string;
};

export const createStorefront: Tool<typeof InputSchema> = {
  name: "createStorefront",
  kind: "action",
  role: "user",
  description:
    "Build and publish a storefront website for the owner's business on AgentWired, taking USDC on Solana straight to the owner's wallet. Pass the business name, its type (for example food, retail or services), a short description, the products with prices in USD, and the Solana wallet that receives payments. Returns the live store link to share with the owner.",
  input: InputSchema,
  async run({ args, ctx }) {
    const token = config.AGENTWIRED_SERVICE_TOKEN;
    if (!token) {
      return {
        ok: false,
        errorClass: "UNAVAILABLE",
        message: "Storefront creation is not configured on this platform yet.",
      };
    }

    // The wallet in the token is the owner's; it can be the payout address
    // only when it is a Solana one. Otherwise the agent has to ask.
    const recipient =
      args.solanaWallet ?? (looksLikeSolanaAddress(ctx.wallet) ? ctx.wallet : null);
    if (!recipient || !looksLikeSolanaAddress(recipient)) {
      return {
        ok: false,
        errorClass: "BAD_INPUT",
        message:
          "Ask the owner for the Solana wallet that should receive USDC payments, then call again with solanaWallet.",
      };
    }

    let response: Response;
    try {
      response = await fetch(`${config.AGENTWIRED_URL}/api/integrations/perkos/stores`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(buildStorefrontRequest(args, ctx.wallet, recipient)),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return {
        ok: false,
        errorClass: "UNAVAILABLE",
        message: "AgentWired did not answer. Try again in a minute.",
      };
    }

    const data = (await response.json().catch(() => null)) as StoreResponse | null;
    if (!response.ok || !data?.store) {
      return {
        ok: false,
        errorClass: response.status >= 500 ? "UNAVAILABLE" : "BAD_INPUT",
        message: data?.error ?? `AgentWired answered ${response.status}.`,
      };
    }

    const store = data.store;
    return {
      ok: true,
      data: {
        name: store.name,
        status: store.status,
        storeUrl: store.storeUrl,
        catalogUrl: store.catalogUrl,
        tenantId: store.tenantId,
        payments: "USDC on Solana",
        recipient,
      },
    };
  },
};
