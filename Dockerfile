# syntax=docker/dockerfile:1.7
#
# PerkOS Platform Tools API.
#
# Multi-stage:
#   1. deps   — npm ci with full deps for build
#   2. build  — tsc -> dist/
#   3. run    — slim production image with only prod node_modules + dist/
#               + bundled runbook + plugin catalog
#
# The runbook + plugin catalog are baked in at /opt/perkos-runbook +
# /opt/perkos-plugins so the tools can read them without bind-mounts.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    RUNBOOK_DIR=/opt/perkos-runbook \
    PLUGIN_CATALOG_PATH=/opt/perkos-plugins/catalog.json

# tini for signal forwarding; ca-certs already in alpine.
RUN apk add --no-cache tini

# Production deps only — keeps the image small (~150 MB).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force

COPY --from=build /app/dist ./dist
COPY runbook /opt/perkos-runbook
COPY plugins /opt/perkos-plugins

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "-g", "--"]
CMD ["node", "dist/server.js"]
