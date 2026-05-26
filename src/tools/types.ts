/**
 * Shared types for tool definitions.
 *
 * A `Tool` is a self-contained module with:
 *   - name           the LLM-visible identifier (e.g. "listMyAgents")
 *   - kind           "read" or "action" — drives rate limiting tier
 *   - role           "user" (any wallet) or "admin" (super-admin only)
 *   - description    short description; surfaces in /v1/tools catalog
 *   - input          zod schema for args validation
 *   - run            async handler — receives validated args + auth ctx
 */

import type { z } from "zod";

import type { TokenClaims } from "../auth/jwt.js";

export type ToolResult<TData = unknown> =
  | { ok: true; data: TData }
  | {
      ok: false;
      errorClass:
        | "NOT_FOUND"
        | "FORBIDDEN"
        | "BAD_INPUT"
        | "INTERNAL"
        | "UNAVAILABLE";
      message: string;
    };

export type Tool<TSchema extends z.ZodTypeAny> = {
  name: string;
  kind: "read" | "action";
  role: "user" | "admin";
  description: string;
  input: TSchema;
  run(opts: {
    args: z.infer<TSchema>;
    ctx: TokenClaims;
  }): Promise<ToolResult>;
};

/** Runtime-erased tool used by the dispatcher. */
export type AnyTool = {
  name: string;
  kind: "read" | "action";
  role: "user" | "admin";
  description: string;
  input: z.ZodTypeAny;
  run(opts: { args: unknown; ctx: TokenClaims }): Promise<ToolResult>;
};
