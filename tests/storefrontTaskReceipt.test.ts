import { describe, expect, it, vi } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);

vi.mock("../src/activityEvents.js", () => ({ logActivity: vi.fn() }));

const { reconcileStorefrontTask, storefrontReceiptResult } = await import("../src/tools/createStorefront.js");

function fakeFirestore(task: Record<string, unknown>, lease: Record<string, unknown>) {
  const writes: Array<{ kind: string; value?: Record<string, unknown> }> = [];
  const taskRef = { kind: "task" };
  const leaseRef = { kind: "lease" };
  const chain = (kind: "wallet" | "project") => ({
    collection: () => ({ doc: () => kind === "wallet" ? chain("project") : taskRef }),
  });
  const firestore = {
    collection(name: string) {
      if (name === "agent_dispatch_leases") return { doc: () => leaseRef };
      return { doc: () => chain("wallet") };
    },
    async runTransaction(work: (tx: unknown) => Promise<void>) {
      await work({
        get: async (ref: unknown) => ref === taskRef
          ? { exists: true, data: () => task }
          : { exists: true, data: () => lease },
        set: (_ref: unknown, value: Record<string, unknown>) => writes.push({ kind: "set", value }),
        delete: () => writes.push({ kind: "delete" }),
      });
    },
  };
  return { firestore: firestore as never, writes };
}

const receipt = {
  tenantId: "surf-shop-1",
  storeUrl: "https://surf-shop-1.agentwired.test",
  catalogUrl: "https://surf-shop-1.agentwired.test/catalog",
  checkoutMode: "test" as const,
  paymentNetwork: "base" as const,
  imageCoverage: { assigned: 5, total: 12, requiresOwnerReview: true },
};

describe("storefront task receipt", () => {
  it("summarizes the verified business effect", () => {
    expect(storefrontReceiptResult(receipt)).toContain("https://surf-shop-1.agentwired.test");
    expect(storefrontReceiptResult(receipt)).toContain("5/12");
  });

  it("completes only the task protected by the matching claim and lease", async () => {
    const claimToken = "claim-token-1234567890";
    const { firestore, writes } = fakeFirestore(
      { name: "Publish store", status: "In progress", agent: "Store-Builder", claim: { token: claimToken } },
      { token: claimToken, wallet: "0xabc", agent: "Store-Builder", projectId: "p1", taskId: "t1" },
    );
    const result = await reconcileStorefrontTask({
      wallet: "0xabc", agent: "Store-Builder",
      context: { projectId: "p1", taskId: "t1", claimToken }, receipt,
    }, firestore);
    expect(result).toBe("applied");
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "set", value: expect.objectContaining({ status: "Done", dispatchState: "completed", completionSource: "tool_receipt" }) }),
      expect.objectContaining({ kind: "delete" }),
    ]));
  });

  it("does not complete a task when the claim is stale", async () => {
    const { firestore, writes } = fakeFirestore(
      { status: "In progress", agent: "Store-Builder", claim: { token: "new-token-123456" } },
      { token: "new-token-123456", wallet: "0xabc", agent: "Store-Builder", projectId: "p1", taskId: "t1" },
    );
    const result = await reconcileStorefrontTask({
      wallet: "0xabc", agent: "Store-Builder",
      context: { projectId: "p1", taskId: "t1", claimToken: "old-token-123456" }, receipt,
    }, firestore);
    expect(result).toBe("mismatch");
    expect(writes).toEqual([]);
  });
});
