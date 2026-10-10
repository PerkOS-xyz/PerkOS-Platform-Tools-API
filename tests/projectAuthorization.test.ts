import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const fixture = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), writes: [] as string[], fail: "", post: vi.fn() }));
function ref(path: string): any {
  return {
    path, id: path.split("/").at(-1),
    get: async () => {
      if (fixture.fail === path) throw new Error("synthetic private path must not leak");
      return { exists: fixture.docs.has(path), data: () => fixture.docs.get(path) };
    },
    collection: (name: string) => ({ doc: (id = "generated") => ref(`${path}/${name}/${id}`) }),
    set: async (data: Record<string, unknown>) => { fixture.writes.push(path); fixture.docs.set(path, data); },
  };
}
vi.mock("../src/firestore.js", () => ({ db: () => ({ collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) }) }));
vi.mock("../src/activityEvents.js", () => ({ logActivity: vi.fn() }));
vi.mock("../src/audit.js", () => ({ audit: vi.fn(), redactArgs: () => ({}) }));
vi.mock("../src/projectChat.js", () => ({ postProjectChat: fixture.post }));
process.env.FIREBASE_PROJECT_ID = "demo-tools-authorization";
process.env.FIREBASE_CLIENT_EMAIL = "fixture@example.com";
process.env.FIREBASE_PRIVATE_KEY = "synthetic";
process.env.JWT_SHARED_SECRET = "s".repeat(40);
process.env.PERKOS_SOLANA_LOGIN_ENABLED = "true";
const { projectAgentAuthorized, projectCallerAuthorized } = await import("../src/projectAuthorization.js");
const { createTask } = await import("../src/tools/createTask.js");
const { upsertPlanTask } = await import("../src/tools/upsertPlanTask.js");
const { postProjectMessage } = await import("../src/tools/postProjectMessage.js");
const { registerV1Routes } = await import("../src/routes/v1.js");
const { signToken } = await import("../src/auth/jwt.js");
const wallet = `0x${"ab".repeat(20)}`;
const other = `0x${"cd".repeat(20)}`;
const projectId = "project-fixture";
const project = `wallets/${wallet}/projects/${projectId}`;
const edge = `${project}/agentMembers/Fixture`;
const ctx = { wallet, agent: "Fixture", convId: "not-an-agent-identity", role: "user" as const, requestId: "fixture", iat: 0, exp: 9999999999 };
function seedAgent(owner = wallet, board = wallet) {
  fixture.docs.set(`wallets/${board}/projects/${projectId}`, { agentIds: ["Fixture", "Foreign"] });
  fixture.docs.set(`wallets/${board}/projects/${projectId}/agentMembers/Fixture`, { status: "active", agentName: "Fixture", agentOwnerWallet: owner, role: "worker" });
  fixture.docs.set("agents/Fixture", { name: "Fixture", walletAddress: owner, agentId: "auto-id" });
  fixture.docs.set(`wallets/${owner}/agents/auto-id`, { name: "Fixture", walletAddress: owner });
}
beforeEach(() => { fixture.docs.clear(); fixture.writes.length = 0; fixture.fail = ""; fixture.post.mockReset().mockResolvedValue({ id: "fixture-message", delivered: 1 }); seedAgent(); });
describe("server-owned project tool authorization", () => {
  it("accepts own and explicitly shared agents without treating the board wallet as the owner", async () => {
    expect(await projectCallerAuthorized(ctx, { projectId })).toBe(true);
    seedAgent(other);
    expect(await projectAgentAuthorized(wallet, projectId, "Fixture")).toBe(true);
  });
  it.each(["removed", "missing", "wrong-owner", "wrong-id", "wrong-name", "revoked", "missing-mirror"])("rejects %s without writes", async failure => {
    if (failure === "removed") fixture.docs.get(edge)!.status = "removed";
    if (failure === "missing") fixture.docs.delete(edge);
    if (failure === "wrong-owner") fixture.docs.get("agents/Fixture")!.walletAddress = other;
    if (failure === "wrong-id") fixture.docs.get("agents/Fixture")!.agentId = "other-id";
    if (failure === "wrong-name") fixture.docs.get("agents/Fixture")!.name = "Other";
    if (failure === "revoked") fixture.docs.get("agents/Fixture")!.status = "revoked";
    if (failure === "missing-mirror") fixture.docs.delete(`wallets/${wallet}/agents/auto-id`);
    expect(await projectCallerAuthorized(ctx, { projectId })).toBe(false);
    expect(fixture.writes).toEqual([]);
  });
  it("does not infer an actor from a legacy convId or grant access from raw agentIds", async () => {
    expect(await projectCallerAuthorized({ ...ctx, agent: undefined, convId: "agent:Fixture" }, { projectId })).toBe(false);
    expect(await projectAgentAuthorized(wallet, projectId, "Foreign")).toBe(false);
    expect(await projectCallerAuthorized(ctx, { topic: "platform" })).toBe(true);
  });
  it("normalizes EVM only and keeps Solana wallet case", async () => {
    expect(await projectAgentAuthorized(wallet.toUpperCase().replace("0X", "0x"), projectId, "Fixture")).toBe(true);
    const solana = "So11111111111111111111111111111111111111112";
    seedAgent(solana, solana);
    expect(await projectAgentAuthorized(solana, projectId, "Fixture")).toBe(true);
    expect(await projectAgentAuthorized(solana.toLowerCase(), projectId, "Fixture")).toBe(false);
  });
  it("validates assigned task destination before writes or dispatch markers", async () => {
    expect(await createTask.run({ ctx, args: { projectId, name: "Synthetic task", agent: "Foreign" } })).toMatchObject({ ok: false, errorClass: "FORBIDDEN" });
    expect(fixture.writes).toEqual([]);
    expect((await createTask.run({ ctx, args: { projectId, name: "Synthetic task", agent: "Fixture" } })).ok).toBe(true);
    expect(fixture.writes).toContain(`active_boards/${wallet}__${projectId}`);
  });
  it("validates proposed assignment before ensureDoc can create anything", async () => {
    expect(await upsertPlanTask.run({ ctx, args: { projectId, title: "Synthetic plan", groupId: "group", suggestedAgent: "Foreign", planningRunId: "run-fixture" } })).toMatchObject({ ok: false, errorClass: "FORBIDDEN" });
    expect(fixture.writes).toEqual([]);
  });
  it("uses the signed actor, not convId, and rejects a forged project lead", async () => {
    await postProjectMessage.run({ ctx, args: { projectId, text: "Synthetic update" } });
    expect(fixture.post).toHaveBeenCalledWith(expect.objectContaining({ sender: "agent:Fixture" }));
    fixture.post.mockClear(); fixture.docs.get(project)!.pmAgent = "Foreign";
    expect((await postProjectMessage.run({ ctx, args: { projectId, text: "Synthetic update" } })).ok).toBe(false);
    expect(fixture.post).not.toHaveBeenCalled();
  });
  it("propagates read failures without writes or message delivery", async () => {
    fixture.fail = "agents/Fixture";
    await expect(projectCallerAuthorized(ctx, { projectId })).rejects.toThrow("synthetic");
    await expect(createTask.run({ ctx, args: { projectId, name: "Synthetic task", agent: "Fixture" } })).rejects.toThrow("synthetic");
    expect(fixture.writes).toEqual([]); expect(fixture.post).not.toHaveBeenCalled();
  });
  it("guards project tools at the actual HTTP boundary and hides database errors", async () => {
    const app = Fastify({ logger: false });
    await registerV1Routes(app);
    const send = () => app.inject({ method: "POST", url: "/v1/tools/createTask", headers: { authorization: `Bearer ${signToken(ctx)}` }, payload: { projectId, name: "Synthetic task" } });
    fixture.docs.get(edge)!.status = "removed";
    expect((await send()).statusCode).toBe(403); expect(fixture.writes).toEqual([]);
    fixture.docs.get(edge)!.status = "active"; fixture.fail = "agents/Fixture";
    const result = await send(); expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain("private path"); expect(fixture.writes).toEqual([]);
    await app.close();
  });
});
