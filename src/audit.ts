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
import { getMetrics } from "./metrics.js";
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
  const db_ = firestore ?? db();
  const docId = `${ts}-${claims.requestId}`;
  const payload = {
    ts: FieldValue.serverTimestamp(),
    // Numeric mirror of `ts` — Firestore serverTimestamp isn't
    // available client-side at write time, so admins paging
    // ?before=<ms> need this. Identical to the docId prefix.
    tsMs: ts,
    requestId: claims.requestId,
    wallet: claims.wallet,
    // Which agent credential was used. Without it every agent action in the
    // log is indistinguishable from the owner's own, so a leaked credential
    // leaves no trace of WHICH agent it impersonated.
    agent: claims.agent ?? null,
    convId: claims.convId,
    role: claims.role,
    tool: record.tool,
    ok: record.ok,
    latencyMs: record.latencyMs,
    argsRedacted: record.argsRedacted,
    errorClass: record.errorClass ?? null,
  };

  // Per-wallet write — primary record, used by per-wallet detail views.
  const perWalletRef = db_
    .collection("audit_log")
    .doc("tool_calls")
    .collection(claims.wallet)
    .doc(docId);

  // Flat mirror — same payload, single collection so admins can
  // orderBy("tsMs", "desc") across every wallet in one query. The
  // collection is meant for the *recent* tail; a separate retention
  // job trims it (out of scope for this PR — write everything; trim
  // later via a Firestore TTL policy on the tsMs field).
  const flatRef = db_.collection("audit_log_entries").doc(docId);

  // Use Promise.allSettled so a failure on one doesn't drop the
  // other — and we still bump the metric per-write rather than once.
  void Promise.allSettled([perWalletRef.set(payload), flatRef.set(payload)])
    .then(([perWallet, flat]) => {
      const metrics = getMetrics();
      if (perWallet.status === "fulfilled") {
        metrics.auditWrites.inc({ result: "success" });
      } else {
        metrics.auditWrites.inc({ result: "error" });
        // eslint-disable-next-line no-console
        console.error(
          `[audit] per-wallet write failed for ${claims.wallet} ${record.tool}:`,
          perWallet.reason instanceof Error
            ? perWallet.reason.message
            : String(perWallet.reason),
        );
      }
      if (flat.status === "fulfilled") {
        metrics.auditWrites.inc({ result: "success" });
      } else {
        metrics.auditWrites.inc({ result: "error" });
        // eslint-disable-next-line no-console
        console.error(
          `[audit] flat mirror write failed for ${claims.wallet} ${record.tool}:`,
          flat.reason instanceof Error
            ? flat.reason.message
            : String(flat.reason),
        );
      }
    });
}
