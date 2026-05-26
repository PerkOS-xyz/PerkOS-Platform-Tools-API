/**
 * Runtime config, sourced from env vars + validated with zod.
 *
 * Single source of truth — every module imports `config` from here.
 * Fail-fast: on missing/invalid env, throws at startup with a clear
 * message rather than letting a request crash later with a confusing
 * stack trace.
 */

import { z } from "zod";

const schema = z.object({
  // --- Server ---
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // --- Firebase Admin SDK ---
  // The miniapp container uses these too; same Firebase project.
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  // Firebase ships private keys with literal "\n" sequences inside the
  // env string. We unescape at load time so the SDK sees real newlines.
  FIREBASE_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((s) => s.replace(/\\n/g, "\n")),

  // --- JWT (per-request auth from the bridge) ---
  // HS256 HMAC. Must be shared with the bridge container that mints
  // the JWT. Rotate per SECRETS.md (90-day schedule).
  JWT_SHARED_SECRET: z.string().min(32, "JWT_SHARED_SECRET must be at least 32 chars"),

  // Max JWT age. Bridge mints short-lived tokens (30s) so even if
  // intercepted on the local docker network they expire quickly.
  JWT_MAX_AGE_SECONDS: z.coerce.number().int().min(5).max(300).default(60),

  // --- Rate limit ---
  // Per-wallet token bucket. Reads are cheap; actions are throttled
  // tighter.
  RATE_LIMIT_READ_PER_MIN: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_ACTION_PER_MIN: z.coerce.number().int().min(1).default(10),

  // --- Audit ---
  // If false, audit log writes are dropped (used in tests). Production
  // MUST keep this on.
  AUDIT_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() === "true"),

  // --- Content paths ---
  // Where runbook .md files live (bundled in the container at build).
  RUNBOOK_DIR: z.string().default("/opt/perkos-runbook"),
  // Static plugin catalog json.
  PLUGIN_CATALOG_PATH: z.string().default("/opt/perkos-plugins/catalog.json"),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const config = loadConfig();
