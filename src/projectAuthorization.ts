import { normalizeWalletAddress } from "@perkos/shared-types";
import { db } from "./firestore.js";
import type { TokenClaims } from "./auth/jwt.js";

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1500
    && !value.includes("/") && value !== "." && value !== "..";
}

/** Only the server-owned edge plus both agent records can grant project access.
 * A read failure propagates: it is not a negative cache entry or a grant. */
export async function projectAgentAuthorized(walletInput: string, projectId: string, name: string, role?: "pm") {
  const wallet = normalizeWalletAddress(walletInput);
  if (!safeId(wallet) || !safeId(projectId) || !safeId(name)) return false;
  const project = db().collection("wallets").doc(wallet).collection("projects").doc(projectId);
  if (!(await project.get()).exists) return false;
  const member = await project.collection("agentMembers").doc(name).get();
  const edge = member.data();
  if (!member.exists || !edge || edge.status !== "active" || edge.agentName !== name
    || !["worker", "pm"].includes(edge.role) || (role && edge.role !== role)
    || !safeId(edge.agentOwnerWallet)) return false;
  const owner = normalizeWalletAddress(edge.agentOwnerWallet);
  const global = await db().collection("agents").doc(name).get();
  const binding = global.data();
  if (!global.exists || !binding || typeof binding.walletAddress !== "string"
    || normalizeWalletAddress(binding.walletAddress) !== owner || !safeId(binding.agentId)
    || (binding.name !== undefined && binding.name !== name)
    || ["revoked", "suspended", "deleted", "removed"].includes(String(binding.status).toLowerCase())) return false;
  const mirror = owner === "platform"
    ? await db().collection("platform_agents").doc(binding.agentId).get()
    : await db().collection("wallets").doc(owner).collection("agents").doc(binding.agentId).get();
  const record = mirror.data();
  if (!mirror.exists || !record || (record.name ?? binding.agentId) !== name
    || (record.walletAddress !== undefined && (typeof record.walletAddress !== "string"
      || normalizeWalletAddress(record.walletAddress) !== owner))) return false;
  return owner !== "platform" || (record.walletAddress === "platform" && record.kind === "platform" && binding.kind === "platform");
}

/** convId is routing context, never an actor claim or membership grant. */
export async function projectCallerAuthorized(ctx: TokenClaims, args: unknown) {
  if (!args || typeof args !== "object" || !("projectId" in args)) return true;
  const projectId = (args as { projectId: unknown }).projectId;
  return typeof projectId === "string" && typeof ctx.agent === "string"
    && await projectAgentAuthorized(ctx.wallet, projectId, ctx.agent);
}

export const projectAccessDenied = {
  ok: false as const, errorClass: "FORBIDDEN" as const, message: "Project agent access is not authorized.",
};
