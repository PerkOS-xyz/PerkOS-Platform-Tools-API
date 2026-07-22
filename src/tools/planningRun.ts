import { z } from "zod";

export const planningRunIdSchema = z.string().uuid().optional();

export type PlanningRunDecision = "allow" | "missing" | "stale";

/** A planning token binds every draft mutation to the single PM turn that
 * atomically claimed the project. Legacy workflows without a token remain
 * usable while deployments roll forward. */
export function planningRunDecision(
  workflow: Record<string, unknown> | null | undefined,
  supplied: string | undefined,
): PlanningRunDecision {
  if (String(workflow?.phase ?? "") !== "planning") return "allow";
  const expected =
    typeof workflow?.planningRunId === "string" ? workflow.planningRunId : "";
  if (!expected) return "allow";
  if (!supplied) return "missing";
  return supplied === expected ? "allow" : "stale";
}

export function planningRunError(decision: Exclude<PlanningRunDecision, "allow">): string {
  return decision === "missing"
    ? "This planning run requires its planningRunId. Use the token from the PM assignment."
    : "This planning turn is stale. Stop without changing the plan; a newer PM turn owns it.";
}
