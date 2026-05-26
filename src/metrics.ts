/**
 * Prometheus metrics for the Platform Tools API.
 *
 * Same prom-client + namespaced `perkos_*` pattern the miniapp uses
 * (see PerkOS/app/lib/metrics.ts). Lives at one /metrics endpoint
 * (registered in routes/metrics.ts) behind a bearer-token gate.
 *
 * What we instrument:
 *
 *   - perkos_toolsapi_request_total{tool,result}
 *       Counter per dispatch. `result` is one of:
 *         success         tool returned ok=true
 *         tool-error      tool returned ok=false (incl. NOT_FOUND, BAD_INPUT)
 *         not-found       requested tool doesn't exist
 *         rate-limited    bucket exhausted
 *         bad-input       zod validation failed
 *         internal        tool handler threw
 *         unauthorized    forbidden / admin-required
 *
 *   - perkos_toolsapi_request_duration_seconds{tool}
 *       Histogram over dispatch latency. Buckets sized for the
 *       expected sub-second tool calls (worst case Firestore round
 *       trip) plus a couple wider buckets for outliers.
 *
 *   - perkos_toolsapi_auth_failures_total{reason}
 *       JWT verify rejections, by reason ("bad signature",
 *       "token expired", ...). Useful for spotting credential drift.
 *
 *   - perkos_toolsapi_audit_writes_total{result}
 *       Counter for audit log Firestore writes. We never fail tool
 *       calls on audit write errors, so this is the only signal
 *       that they're silently dropping.
 *
 *   - perkos_process_* / perkos_nodejs_*  (defaults)
 */
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

let cachedRegistry: Registry | null = null;
let cachedMetrics: PerkosToolsApiMetrics | null = null;

export type PerkosToolsApiMetrics = {
  requestTotal: Counter<"tool" | "result">;
  requestDuration: Histogram<"tool">;
  authFailures: Counter<"reason">;
  auditWrites: Counter<"result">;
};

function init(): { register: Registry; metrics: PerkosToolsApiMetrics } {
  if (cachedRegistry && cachedMetrics) {
    return { register: cachedRegistry, metrics: cachedMetrics };
  }
  const register = new Registry();
  collectDefaultMetrics({ register, prefix: "perkos_" });

  const requestTotal = new Counter({
    name: "perkos_toolsapi_request_total",
    help: "Tool dispatch requests, labelled by tool name + outcome class.",
    labelNames: ["tool", "result"] as const,
    registers: [register],
  });
  const requestDuration = new Histogram({
    name: "perkos_toolsapi_request_duration_seconds",
    help: "Wall-clock latency of one tool dispatch, in seconds.",
    labelNames: ["tool"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });
  const authFailures = new Counter({
    name: "perkos_toolsapi_auth_failures_total",
    help: "JWT verification rejections by reason string.",
    labelNames: ["reason"] as const,
    registers: [register],
  });
  const auditWrites = new Counter({
    name: "perkos_toolsapi_audit_writes_total",
    help: "Audit log Firestore writes, labelled by outcome.",
    labelNames: ["result"] as const,
    registers: [register],
  });

  cachedRegistry = register;
  cachedMetrics = { requestTotal, requestDuration, authFailures, auditWrites };
  return { register, metrics: cachedMetrics };
}

export function getRegistry(): Registry {
  return init().register;
}

export function getMetrics(): PerkosToolsApiMetrics {
  return init().metrics;
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  const register = getRegistry();
  return {
    body: await register.metrics(),
    contentType: register.contentType,
  };
}
