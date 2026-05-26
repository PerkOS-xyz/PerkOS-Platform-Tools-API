/**
 * Audit log writer — every tool invocation lands as a Firestore doc
 * at `/audit_log/tool_calls/{wallet}/{ts}-{requestId}`.
 *
 * Fields:
 *   - tool          name of the invoked tool (e.g. "listMyAgents")
 *   - role          "user" | "admin"
 *   - argsRedacted  arg keys + value-type hints, no PII / no plaintext
 *   - latencyMs     end-to-end (validation through response)
 *   - ok            true/false
 *   - errorClass    short error label if !ok (e.g. "NOT_FOUND", "RATE_LIMITED")
 *
 * Writes are fire-and-forget — the response to the LLM doesn't wait
 * on Firestore. Failures are logged but don't surface as 5xx.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { config } from "./config.js";
import { db } from "./firestore.js";
import type { TokenClaims } from "./auth/jwt.js";

export type AuditRecord = {
  tool: string;
  ok: boolean;
  latencyMs: number;
  argsRedacted: Record<string, string>;
  errorClass?: string;
};

function redactValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  switch (typeof v) {
    case "string":
      // Show length, not content — handles PII + secrets uniformly.
      return `string(${v.length})`;
    case "number":
      return `number`;
    case "boolean":
      return `bool`;
    case "object":
      return `object(${Object.keys(v as object).length})`;
    default:
      return typeof v;
  }
}

export function redactArgs(args: unknown): Record<string, string> {
  if (typeof args !== "object" || args === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = redactValue(v);
  }
  return out;
}

/** Fire-and-forget audit write. Never throws. */
export function audit(
  claims: TokenClaims,
  record: AuditRecord,
  firestore: Firestore | null = null,
): void {
  if (!config.AUDIT_ENABLED) return;

  const ts = Date.now();
  const ref = (firestore ?? db())
    .collection("audit_log")
    .doc("tool_calls")
    .collection(claims.wallet)
    .doc(`${ts}-${claims.requestId}`);

  ref
    .set({
      ts: FieldValue.serverTimestamp(),
      requestId: claims.requestId,
      wallet: claims.wallet,
      convId: claims.convId,
      role: claims.role,
      tool: record.tool,
      ok: record.ok,
      latencyMs: record.latencyMs,
      argsRedacted: record.argsRedacted,
      errorClass: record.errorClass ?? null,
    })
    .catch((err: unknown) => {
      // Audit write failed — log but don't crash the request path.
      // eslint-disable-next-line no-console
      console.error(
        `[audit] write failed for ${claims.wallet} ${record.tool}:`,
        err instanceof Error ? err.message : String(err),
      );
    });
}
