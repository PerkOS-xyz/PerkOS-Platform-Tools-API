/** Worker-facing task completion is terminal and cannot move backwards. */
export function isTerminalTaskTransition(current: unknown, requested: string): boolean {
  return current === "Done" && requested !== "Done";
}

export function dispatchStateForStatus(status: string): "queued" | "working" | "review" | "completed" {
  if (status === "In progress") return "working";
  if (status === "Review") return "review";
  if (status === "Done") return "completed";
  return "queued";
}

/**
 * A claim holder's update refreshes the claim TTL, except when it finishes:
 * Done and Review release the claim instead. Doing both in one write is
 * rejected by Firestore ("Field claim was specified multiple times"), which
 * left every protocol-following worker unable to finish its task.
 */
export function refreshesClaim(status: string, holder: boolean): boolean {
  return holder && status !== "Done" && status !== "Review";
}
