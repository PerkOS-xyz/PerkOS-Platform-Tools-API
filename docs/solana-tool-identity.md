# Independent Solana tool identities

This service consumes short-lived HS256 tokens from a trusted A2A bridge, not
browser login tokens. Wallet scope always comes from the verified token, never
from model-supplied tool arguments.

- `PERKOS_SOLANA_LOGIN_ENABLED` defaults to `false`. Only the exact value `true`
  enables Solana tokens. Keep it disabled until the coordinated rollout.
- Solana requires a valid canonical 32-byte base58 wallet and an explicit,
  matching `walletChain: "solana"` claim. Preserve case in ownership checks,
  activity paths, tool data and rate budgets.
- Initial Solana claims always resolve to role `user`, even when a trusted
  issuer supplies `admin`. No linking or inherited infrastructure sponsorship.
- Existing valid EVM tokens without a chain claim remain supported, lowercase
  normalized, with their existing role. Mismatched chain claims fail closed.
- Use the updated A2A signer and MCP owner handling from A2A PR106. An older
  signer without the Solana claim is intentionally rejected.

## Verification and rollout

60 tests pass, including disabled gate, wrong chain, exact-case isolation,
role downgrade, EVM compatibility and owner-scoped agent lookup. Clean `npm ci`,
TypeScript and build pass. A compiled A2A signer was checked against this compiled
verifier with three synthetic identities; no credentials or live data used.

Docker now installs the pinned public HTTPS shared-types dependency with `npm ci`.
Local image verification is unavailable while Docker Desktop is stopped; CI must
complete both test and image smoke before deployment. Do not enable production
solely because these unit tests pass. Merge, deploy compatible App/API/Chat/Tools,
publish/update A2A through its normal release process, then verify real signed
login, chat/history reload and workspace isolation. No production changes in
this implementation.
