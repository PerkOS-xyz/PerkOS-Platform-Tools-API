# Secrets — what lives where + rotation schedule

Per the enterprise plan decision: we use **.env files** on the LLM VPS for now, not AWS Secrets Manager. This document is the operational discipline that compensates.

## Secrets owned by this service

| Secret | Lives at | Source | Rotation cadence | Last rotated |
|---|---|---|---|---|
| `FIREBASE_PRIVATE_KEY` | `/opt/perkos-platform-tools-api/.env` | Firebase Console > Project settings > Service accounts > Generate key | Every 180 days, OR immediately on suspected compromise | (set on first deploy) |
| `JWT_SHARED_SECRET` | `/opt/perkos-platform-tools-api/.env` + `/opt/perkos-assistant/Perkos-Containers/deploy/perkos-assistant/.env` (must match the bridge!) | `openssl rand -hex 32` | Every 90 days | (set on first deploy) |

## Rotation runbook

### JWT_SHARED_SECRET (every 90 days)

This secret is shared with the perkos-a2a-bridge. Rotating requires coordinating BOTH containers — if they disagree even briefly, the bridge → tools-api auth fails for the duration.

Recommended approach: **dual-secret rolling** (allow either secret to validate for a 5-minute window):

1. Generate new: `NEW=$(openssl rand -hex 32)`
2. SSH to LLM VPS, edit both .env files:
   - Tools API: support both via comma-separated `JWT_SHARED_SECRETS=$OLD,$NEW` (requires code change — TODO for v2; for v1, accept the brief downtime)
   - Bridge: switch to `$NEW` only
3. Restart bridge first (it'll start signing with $NEW)
4. Restart tools-api (now expecting $NEW)
5. Verify with: `curl -fsS https://app.perkos.xyz/agents/new` and a chat message to the Assistant — confirm tool calls work
6. Update this file's "Last rotated" + commit to repo
7. Audit: search Firestore `/audit_log/tool_calls` for 401s in the rotation window; if any wallet was caught mid-flight, ping them in support

### FIREBASE_PRIVATE_KEY (every 180 days)

The miniapp container (`62.238.28.49:/opt/perkos-miniapp/.env`) uses the SAME service account today, so rotating affects both:

1. Firebase Console > Project settings > Service accounts > Generate key
2. Copy the new `private_key` into both `.env` files (miniapp + tools-api)
3. Restart both containers
4. Revoke the OLD key in Firebase Console
5. Update this file's "Last rotated"

If we later split into separate service accounts (recommended at scale), rotate independently.

## Hygiene checklist

- [ ] All `.env` files have `chmod 600`
- [ ] No `.env` file ever committed (gitignored)
- [ ] No secret printed in any log line (audit log uses `redactArgs` to strip)
- [ ] Bridge → tools-api traffic stays on the local docker network (no public exposure)
- [ ] On any suspected leak: rotate the affected secret within 1 hour

## Compromise response (incident playbook)

If you suspect `JWT_SHARED_SECRET` leaked:

1. Rotate immediately (don't wait for the 90-day mark)
2. Query Firestore `/audit_log/tool_calls` for the last 24h — look for unexpected patterns (spike from one wallet, calls from unknown convIds, off-hours admin tool usage)
3. If anything looks anomalous, escalate to platform admins + consider revoking affected agents

If `FIREBASE_PRIVATE_KEY` leaked: revoke the key in Firebase Console BEFORE generating a new one. Anyone with the old key has admin access to your Firebase project — assume the worst, audit Firestore activity logs.
