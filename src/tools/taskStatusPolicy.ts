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

const PLACEHOLDER_RESULT =
  /^(the )?(task )?(is )?(done|complete|completed|finished|ok|okay|ready|submitted|delivered|see above|n a)$/;

/**
 * A finishing result that only announces completion ("done", "Completed.")
 * instead of carrying the deliverable. Accepting it would close the task with
 * nothing for the person to read, so the worker is asked to send the work.
 */
export function isPlaceholderResult(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized === "" || PLACEHOLDER_RESULT.test(normalized);
}
