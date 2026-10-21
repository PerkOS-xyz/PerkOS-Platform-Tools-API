/**
 * createStorefront(name, vertical, description, items, checkoutMode?, paymentNetwork?, payoutWallet?)
 *   → {name, status, storeUrl, catalogUrl, tenantId, payments, recipient}
 *
 * Builds and publishes an AgentWired storefront for the calling wallet's
 * business. Live USDC payments go straight to the owner's wallet; PerkOS
 * never holds them. The store is keyed to the wallet and the
 * business name, so asking twice returns the same store instead of a second
 * one.
 */

import { z } from "zod";

import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { logActivity } from "../activityEvents.js";
import { config } from "../config.js";
import { db } from "../firestore.js";
import type { Tool } from "./types.js";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function looksLikeSolanaAddress(value: string): boolean {
  return SOLANA_ADDRESS.test(value);
}

export function looksLikeEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(value);
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
  description: z.string().trim().min(20).max(400),
  category: z.string().trim().max(100).optional(),
  imagePrompt: z.string().trim().max(160).optional(),
  imageAsset: z.unknown().optional(),
});

const TaskContextSchema = z
  .object({
    projectId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    taskId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    claimToken: z.string().min(16).max(64),
  })
  .strict();

const InputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  vertical: z.string().trim().min(2).max(40).default("other"),
  description: z.string().trim().max(1000).default(""),
  items: z.array(ItemSchema).min(1).max(20),
  checkoutMode: z.enum(["test", "live"]).default("test"),
  paymentNetwork: z.enum(["base", "solana"]).optional(),
  payoutWallet: z.string().trim().optional(),
  /** @deprecated Use payoutWallet with paymentNetwork. */
  solanaWallet: z.string().trim().optional(),
  /** Assignment context copied from the PerkOS wake prompt. */
  taskContext: TaskContextSchema.optional(),
});

type Input = z.infer<typeof InputSchema>;

export function resolvePaymentNetwork(input: Pick<Input, "paymentNetwork">, wallet: string): "base" | "solana" {
  return input.paymentNetwork ?? (looksLikeSolanaAddress(wallet) ? "solana" : "base");
}

export function buildStorefrontRequest(args: Input, wallet: string, recipient: string) {
  const paymentNetwork = resolvePaymentNetwork(args, wallet);
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
      category: item.category,
      imagePrompt: item.imagePrompt,
      imageAsset: item.imageAsset,
    })),
    paymentMethods: [
      { provider: "crypto", network: paymentNetwork, asset: "USDC", recipient, enabled: true },
    ],
    checkoutMode: args.checkoutMode,
    updateExisting: true,
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
    imageCoverage?: {
      assigned: number;
      total: number;
      requiresOwnerReview: boolean;
    };
  };
  error?: string;
};

type StorefrontTaskReceipt = {
  tenantId: string;
  storeUrl: string;
  catalogUrl: string;
  checkoutMode: "test" | "live";
  paymentNetwork: "base" | "solana";
  imageCoverage?: {
    assigned: number;
    total: number;
    requiresOwnerReview: boolean;
  };
};

export type TaskReceiptResult = "applied" | "already-terminal" | "mismatch";

export function storefrontReceiptResult(store: StorefrontTaskReceipt): string {
  const coverage = store.imageCoverage
    ? ` Images assigned: ${store.imageCoverage.assigned}/${store.imageCoverage.total}; owner review ${store.imageCoverage.requiresOwnerReview ? "required" : "not required"}.`
    : "";
  return `Storefront published: ${store.storeUrl}. Catalog: ${store.catalogUrl}. Checkout: ${store.checkoutMode} mode on ${store.paymentNetwork}.${coverage}`;
}

/**
 * Finish the currently claimed task from the durable business-effect receipt.
 * The three-way task/claim/lease match prevents a direct chat, stale retry, or
 * reassigned worker from closing unrelated work.
 */
export async function reconcileStorefrontTask(
  input: {
    wallet: string;
    agent: string;
    context: z.infer<typeof TaskContextSchema>;
    receipt: StorefrontTaskReceipt;
  },
  firestore: Firestore = db(),
): Promise<TaskReceiptResult> {
  const { wallet, agent, context, receipt } = input;
  const taskRef = firestore
    .collection("wallets")
    .doc(wallet)
    .collection("projects")
    .doc(context.projectId)
    .collection("tasks")
    .doc(context.taskId);
  const leaseRef = firestore.collection("agent_dispatch_leases").doc(`${wallet}__${agent}`);
  let outcome: TaskReceiptResult = "mismatch";
  let taskName = context.taskId;

  await firestore.runTransaction(async (tx) => {
    const [taskSnap, leaseSnap] = await Promise.all([tx.get(taskRef), tx.get(leaseRef)]);
    if (!taskSnap.exists || !leaseSnap.exists) return;
    const task = taskSnap.data() as Record<string, unknown>;
    const lease = leaseSnap.data() as Record<string, unknown>;
    taskName = typeof task.name === "string" ? task.name : taskName;
    if (task.status === "Done" || task.status === "Review") {
      outcome = "already-terminal";
      return;
    }
    const claim = (task.claim ?? null) as { token?: unknown } | null;
    const matches =
      task.agent === agent &&
      claim?.token === context.claimToken &&
      lease.token === context.claimToken &&
      lease.wallet === wallet &&
      lease.agent === agent &&
      lease.projectId === context.projectId &&
      lease.taskId === context.taskId;
    if (!matches) return;

    const review = task.goalMode === true;
    tx.set(
      taskRef,
      {
        status: review ? "Review" : "Done",
        result: storefrontReceiptResult(receipt),
        judgePending: review ? true : FieldValue.delete(),
        claim: FieldValue.delete(),
        dispatchStuck: FieldValue.delete(),
        nextDispatchAtMs: FieldValue.delete(),
        lastDispatchError: FieldValue.delete(),
        workerProtocol: FieldValue.delete(),
        dispatchState: review ? "review" : "completed",
        completionSource: "tool_receipt",
        operationReceipt: {
          tool: "createStorefront",
          tenantId: receipt.tenantId,
          storeUrl: receipt.storeUrl,
          checkoutMode: receipt.checkoutMode,
          recordedAtMs: Date.now(),
        },
        lastWorkerUpdateAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.delete(leaseRef);
    outcome = "applied";
  });

  if ((outcome as TaskReceiptResult) === "applied") {
    logActivity(wallet, {
      actorType: "agent",
      actor: agent,
      verb: "completed_task",
      object: taskName,
      objectType: "task",
      projectId: context.projectId,
      taskId: context.taskId,
      detail: "verified by createStorefront receipt",
    });
  }
  return outcome;
}

export const createStorefront: Tool<typeof InputSchema> = {
  name: "createStorefront",
  kind: "action",
  role: "user",
  description:
    "Build and publish a storefront website for the owner's business on AgentWired. Start with checkoutMode test so the owner can review the real store and checkout without funds or a payout wallet. When working an assigned PerkOS task, copy projectId, taskId, and claimToken from the assignment into taskContext so the verified store receipt completes the task even if the runtime reply is lost. Returns the live store link to share with the owner.",
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
    const paymentNetwork = resolvePaymentNetwork(args, ctx.wallet);
    const walletForNetwork = args.checkoutMode !== "live" ? "" : paymentNetwork === "solana"
      ? (looksLikeSolanaAddress(ctx.wallet) ? ctx.wallet : "")
      : (looksLikeEvmAddress(ctx.wallet) ? ctx.wallet : "");
    const recipient = args.payoutWallet ?? args.solanaWallet ?? walletForNetwork;
    const validRecipient = paymentNetwork === "solana"
      ? looksLikeSolanaAddress(recipient)
      : looksLikeEvmAddress(recipient);
    if (args.checkoutMode === "live" && !validRecipient) {
      return {
        ok: false,
        errorClass: "BAD_INPUT",
        message:
          `Ask the owner for the ${paymentNetwork === "solana" ? "Solana" : "EVM"} wallet that should receive USDC payments, then call again with payoutWallet.`,
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
    let taskReconciliation: TaskReceiptResult | "not-requested" | "deferred" = "not-requested";
    if (args.taskContext) {
      try {
        taskReconciliation = await reconcileStorefrontTask({
          wallet: ctx.wallet,
          agent: ctx.agent?.trim() || ctx.convId,
          context: args.taskContext,
          receipt: {
            tenantId: store.tenantId,
            storeUrl: store.storeUrl,
            catalogUrl: store.catalogUrl,
            checkoutMode: args.checkoutMode,
            paymentNetwork,
            imageCoverage: store.imageCoverage,
          },
        });
      } catch {
        // The business effect succeeded, so never return a failure that would
        // encourage another publish. The agent can still call updateTaskStatus.
        taskReconciliation = "deferred";
      }
    }
    return {
      ok: true,
      data: {
        name: store.name,
        status: store.status,
        storeUrl: store.storeUrl,
        catalogUrl: store.catalogUrl,
        tenantId: store.tenantId,
        payments: args.checkoutMode === "test" ? "USDC checkout in test mode" : `USDC on ${paymentNetwork}`,
        checkoutMode: args.checkoutMode,
        paymentNetwork,
        recipient,
        imageCoverage: store.imageCoverage,
        taskReconciliation,
      },
    };
  },
};
