# Changelog

All notable changes to PerkOS-Platform-Tools-API are recorded here.
Newest first. Each entry captures *what shipped* and the *why*.

## 2026-06-10

### Added — activity events from worker tool calls

- New `src/activityEvents.ts`: fire-and-forget `logActivity` appending
  plain-language events to `/wallets/{wallet}/activity_events` (same shape as
  PerkOS-API's `services/activityEvents.ts` — keep verbs in sync). Feeds the
  mini-app's dashboard activity feed.
- `updateTaskStatus` logs `started_task` / `completed_task` / `moved_task`
  (incl. "submitted for review") on real status changes only — claim
  heartbeats with an unchanged status stay silent.
- `createTask` logs `created_task` (with the assignee), `proposePlan` logs
  `proposed_plan` — which also powers the dashboard's "Waiting on you" queue.

## 2026-06-01

### Added — job-board tools (project tasks + chat)

Four new `user`-role tools so a PM/orchestrator agent and its workers can
drive a project's job board on the platform (the agent-facing gap that
previously forced an orchestration harness):

- **`listProjectTasks({ projectId })`** (read) — the board state: every
  task's id, name, status (`Backlog | In progress | Review | Done`),
  priority, assigned agent, prompt, result.
- **`createTask({ projectId, name, prompt?, priority?, agent? })`**
  (action) — seed/assign a task; `agent` assigns it to a worker by name.
- **`updateTaskStatus({ projectId, taskId, status, result? })`** (action)
  — move a task across the board + record its result.
- **`postProjectMessage({ projectId, text })`** (action) — post into the
  project chat (how a worker notifies the PM); shows live in the app's
  Chat tab.

All are wallet-scoped: the handler uses `ctx.wallet` from the
bridge-minted JWT and reads/writes `wallets/{wallet}/projects/{id}/...`
only — an agent can never touch another wallet's board. Registered in
`src/tools/index.ts`; the catalog + dispatcher pick them up
automatically. Verified end-to-end over HTTPS with a real JWT:
create → update→Done → post → list round-trips correctly.

### Deployed

First production deploy — runs on the **main** VPS at
`/opt/perkos-platform-tools-api`, fronted by Caddy at
`api.perkos.xyz/tools` (internal-only container, `handle_path /tools/*`).
`.env` reuses the miniapp's Firebase project; `JWT_SHARED_SECRET` matches
the API's `A2A_TOOLS_JWT_SECRET`. `docker-compose.example.yml` gained an
overridable shared-network block (`PERKOS_TOOLS_NETWORK`,
default `perkos-knowledge_default`).
