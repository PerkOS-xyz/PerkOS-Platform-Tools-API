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
