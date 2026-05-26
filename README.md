# PerkOS Platform Tools API

Server-side tools that the **PerkOS Assistant** + admin surfaces call. Per-request **JWT auth**, **audit log** to Firestore, **per-wallet rate limiting**, OpenAPI-shaped catalog at `/v1/tools`.

This service replaces the in-Hermes tool registration approach (which doesn't support per-request user context). The bridge container mints a short-lived JWT per inbound chat frame and forwards it on every tool call; this API validates the JWT, enforces tenant isolation server-side, executes, audits, returns.

## Architecture

```
   user (wallet)
      │  WS chat_deliver
      ▼
   chat.perkos.xyz
      │
      ▼
   perkos-a2a-bridge   ── mints JWT{wallet, convId, role, exp:+30s} ──┐
      │  POST /v1/responses                                            │
      ▼                                                                │
   Hermes (LLM)                                                        │
      │  decides to call tool                                          │
      ▼                                                                │
   perkos-platform-tools-api  ◄────────────── JWT in Bearer header ──┘
      │  validates JWT, applies rate limit, runs tool, writes audit log
      ▼
   Firestore / runbook / plugin catalog
```

## Tools shipped (v1)

| Tool | Kind | Role | Purpose |
|---|---|---|---|
| `getRunbookFor` | read | user | Fetch a single runbook entry by slug |
| `searchKnowledge` | read | user | Keyword search across runbook + (future) knowledge_base |
| `listMyAgents` | read | user | List the caller's agents (wallet from JWT, NEVER from args) |
| `getMyAgent` | read | user | Details of one of the caller's agents |
| `explainPlugin` | read | user | Describe a plugin from the static catalog |

Adding a tool: new file under [`src/tools/`](./src/tools/) following the `Tool<TSchema>` interface, then import + push in [`src/tools/index.ts`](./src/tools/index.ts). Catalog endpoint + dispatcher pick it up automatically.

## Endpoints

- `GET /health` — liveness
- `GET /ready` — readiness (also checks Firestore reachable)
- `GET /v1/tools` — catalog (returns each tool's name, kind, role, JSON Schema)
- `POST /v1/tools/:name` — dispatch a tool call. Body = tool input.

All `/v1/*` routes require `Authorization: Bearer <jwt>`.

## Tenant isolation invariant

**The wallet that owns the request is always derived from the JWT, never from the request body or query.** Each tool's `run({args, ctx})` receives the validated args + the auth context — args have NO wallet field on user-scoped tools. Even if the LLM hallucinated a wallet param, it can't be present in the schema, can't reach the handler, can't break isolation.

This is enforced at:
1. Schema layer — tool input schemas don't declare `wallet` for user-scoped reads
2. Handler layer — handlers use `ctx.wallet` exclusively
3. Audit layer — `argsRedacted` records only key + value-shape, no plaintext

## Development

```bash
npm install
cp .env.example .env       # fill in Firebase + JWT secret
npm run dev                # tsx watch
npm test                   # vitest
npm run typecheck
```

## Deployment

See [DEPLOY.md](./DEPLOY.md). Production lives on the LLM VPS alongside `perkos-assistant` + `perkos-assistant-bridge`.

## Secrets rotation

See [SECRETS.md](./SECRETS.md). JWT shared secret rotates every 90 days.
