/** Worker-facing task completion is terminal and cannot move backwards. */
export function isTerminalTaskTransition(current: unknown, requested: string): boolean {
  return current === "Done" && requested !== "Done";
}
