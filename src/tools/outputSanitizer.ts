/** Credentials used to claim work must never become part of user content. */
export function redactClaimTokens(value: string): string {
  return value
    .replace(
      /\bclaimToken\s*[:=]\s*["']?[A-Za-z0-9_-]{16,128}["']?/gi,
      "claimToken=[redacted]",
    )
    .replace(
      /\bclaim token\s*[:=]\s*["']?[A-Za-z0-9_-]{16,128}["']?/gi,
      "claim token=[redacted]",
    );
}
