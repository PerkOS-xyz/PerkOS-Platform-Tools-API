/**
 * Tests for the Prometheus metrics registry shape and the /metrics
 * route. We don't spin up the full Fastify server (the existing tests
 * keep that to the manual smoke + CI image-smoke); instead we exercise
 * the pure prom-client surface, which is where all the labels live.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { getMetrics, getRegistry, renderMetrics } from "../src/metrics.js";

beforeEach(() => {
  getRegistry().resetMetrics();
});

describe("tools-api metrics", () => {
  it("emits prom text with default + business metrics", async () => {
    getMetrics().requestTotal.inc({ tool: "listMyAgents", result: "success" });
    getMetrics().authFailures.inc({ reason: "bad signature" });
    getMetrics().auditWrites.inc({ result: "success" });
    getMetrics().requestDuration.observe({ tool: "listMyAgents" }, 0.02);

    const { body, contentType } = await renderMetrics();
    expect(contentType).toContain("text/plain");
    expect(body).toContain("perkos_toolsapi_request_total");
    expect(body).toContain('tool="listMyAgents"');
    expect(body).toContain('result="success"');
    expect(body).toContain("perkos_toolsapi_auth_failures_total");
    expect(body).toContain('reason="bad signature"');
    expect(body).toContain("perkos_toolsapi_audit_writes_total");
    expect(body).toContain("perkos_toolsapi_request_duration_seconds_bucket");
    expect(body).toContain("perkos_toolsapi_request_duration_seconds_sum");
    expect(body).toContain("perkos_toolsapi_request_duration_seconds_count");
    // Defaults from collectDefaultMetrics.
    expect(body).toContain("perkos_process_");
    expect(body).toContain("perkos_nodejs_");
  });

  it("getMetrics is a process-wide singleton", () => {
    const a = getMetrics();
    const b = getMetrics();
    expect(a).toBe(b);
  });

  it("counters can carry multiple distinct label combos", async () => {
    getMetrics().requestTotal.inc({ tool: "listMyAgents", result: "success" });
    getMetrics().requestTotal.inc({ tool: "listMyAgents", result: "tool-error" });
    getMetrics().requestTotal.inc({ tool: "getRunbookFor", result: "not-found" });
    const { body } = await renderMetrics();
    expect(body).toMatch(/tool="listMyAgents".*result="success"/);
    expect(body).toMatch(/tool="listMyAgents".*result="tool-error"/);
    expect(body).toMatch(/tool="getRunbookFor".*result="not-found"/);
  });

  it("histogram observations land in the expected buckets", async () => {
    getMetrics().requestDuration.observe({ tool: "x" }, 0.003);
    getMetrics().requestDuration.observe({ tool: "x" }, 0.07);
    getMetrics().requestDuration.observe({ tool: "x" }, 1.5);
    const { body } = await renderMetrics();
    // Histogram is monotonic — the +Inf bucket carries all 3 observations.
    expect(body).toMatch(/le="\+Inf".*\} 3/);
  });
});
