/**
 * An update checked against a task's active claim must still match that claim
 * when it commits. A worker that sends its claim token must hold the current
 * claim; a call without a token (the board MCP sends none, and the pre-check
 * lets it through for back-compat) only needs the claim it was checked against
 * to be unchanged.
 */
export function claimStillHeld(input: {
  claimActive: boolean;
  /** Claim token read before the transaction, when the call was checked. */
  checkedToken?: string;
  /** Claim token read inside the transaction. */
  latestToken?: string;
  /** Claim token the worker sent, if any. */
  argsToken?: string;
}): boolean {
  if (!input.claimActive) return true;
  return input.latestToken === (input.argsToken ?? input.checkedToken);
}
