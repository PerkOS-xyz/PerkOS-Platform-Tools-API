# Deploy runbook — PerkOS Platform Tools API

Manual deploy to the LLM VPS (see "Deploy target" below). Lives alongside `perkos-assistant` + `perkos-assistant-bridge`.

## Deploy target

The host and SSH key are deliberately not recorded in this repo. Export them
before running any command below; the real values live in the workspace
`CLAUDE.md`, which is not versioned.

```bash
export DEPLOY_HOST=root@<llm-vps>
export DEPLOY_KEY=~/.ssh/<llm-vps-key>
```

## Prerequisites

- SSH access to the LLM VPS as root, with the deploy key
- Firebase service account JSON (see SECRETS.md for source)
- A fresh `JWT_SHARED_SECRET` (`openssl rand -hex 32`) — must match what the bridge container uses

## One-time bootstrap

### Step 1 — Lay down source on the VPS

```bash
ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" '
  mkdir -p /opt/perkos-platform-tools-api
  cd /opt/perkos-platform-tools-api
  if [ ! -d PerkOS-Platform-Tools-API ]; then
    git clone https://github.com/PerkOS-xyz/PerkOS-Platform-Tools-API.git
  else
    cd PerkOS-Platform-Tools-API && git pull
  fi
'
```

Repo is private — `gh auth setup-git` on the VPS or use rsync from local instead (see Update flow).

### Step 2 — Configure secrets

```bash
ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" '
  cd /opt/perkos-platform-tools-api/PerkOS-Platform-Tools-API
  cp .env.example .env
  chmod 600 .env
  echo "Now edit .env with Firebase + JWT_SHARED_SECRET values"
'
```

Then edit `.env` and set:

- `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` (from the Firebase service account JSON)
- `JWT_SHARED_SECRET` (same value as in `/opt/perkos-assistant/Perkos-Containers/deploy/perkos-assistant/.env` — the bridge needs it)

### Step 3 — Build + run

```bash
ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" '
  cd /opt/perkos-platform-tools-api/PerkOS-Platform-Tools-API
  docker compose -f docker-compose.example.yml build
  docker compose -f docker-compose.example.yml up -d
  sleep 5
  docker logs --tail 20 perkos-platform-tools-api
'
```

First build ~2 min (npm install + tsc). Subsequent rebuilds reuse the layer cache.

### Step 4 — Verify

```bash
ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" \
  'docker inspect perkos-platform-tools-api --format "{{.State.Health.Status}}"'
# Expect: "healthy" within ~30s.

ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" \
  'docker exec perkos-platform-tools-api wget -qO- http://127.0.0.1:8080/health'
# Expect: {"ok":true,"uptime":...}

ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" \
  'docker exec perkos-platform-tools-api wget -qO- http://127.0.0.1:8080/ready'
# Expect: {"ok":true,"deps":{"firestore":"ok"}} — confirms Firebase admin auth works
```

### Step 5 — Wire to the bridge (Phase 2 follow-up)

The bridge needs to know where to call us. Tools-api listens on `8080` inside the `perkos-assistant_default` docker network. The bridge service in `deploy/perkos-assistant/docker-compose.yml` will gain `PERKOS_TOOLS_API_URL=http://perkos-platform-tools-api:8080` once Phase 2 lands.

## Updating

```bash
# Option A: pull from main on the VPS
ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" '
  cd /opt/perkos-platform-tools-api/PerkOS-Platform-Tools-API
  git pull
  docker compose -f docker-compose.example.yml build
  docker compose -f docker-compose.example.yml up -d
'

# Option B: rsync from local (if VPS can't pull from private repo)
rsync -avz -e "ssh -i $DEPLOY_KEY" \
  --exclude={.git/,node_modules/,dist/,.env} \
  ./ "$DEPLOY_HOST":/opt/perkos-platform-tools-api/PerkOS-Platform-Tools-API/

ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" \
  'cd /opt/perkos-platform-tools-api/PerkOS-Platform-Tools-API && \
   docker compose -f docker-compose.example.yml build && \
   docker compose -f docker-compose.example.yml up -d'
```

## Tearing down

```bash
ssh -i "$DEPLOY_KEY" "$DEPLOY_HOST" '
  cd /opt/perkos-platform-tools-api/PerkOS-Platform-Tools-API
  docker compose -f docker-compose.example.yml down
'
```

## Operational notes

- **Logs:** `docker logs -f perkos-platform-tools-api` — structured JSON in production, pretty in dev
- **Restart:** `docker compose -f docker-compose.example.yml restart perkos-platform-tools-api`
- **Network:** internal-only (no port published) — bridge reaches us via compose DNS
- **Cost:** $0 incremental (runs on existing LLM VPS)
- **Audit data:** Firestore `/audit_log/tool_calls/{wallet}/...` — review via Firebase Console or PerkOS-Admin (when the review UI lands in Phase 6)
