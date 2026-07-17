import { config } from "./config.js";

function senderIdentity(value?: string): string {
  if (!value) return "agent:unknown";
  if (value.startsWith("agent:") || value.startsWith("service:")) return value;
  return `agent:${value}`;
}

export async function postProjectChat(input: {
  wallet: string;
  projectId: string;
  convId?: string;
  sender?: string;
  text: string;
  targets?: string[];
  event?: Record<string, unknown>;
}): Promise<{ id: string; delivered: number }> {
  if (!config.CHAT_INTERNAL_API_KEY) {
    throw new Error("CHAT_INTERNAL_API_KEY is not configured");
  }
  const response = await fetch(`${config.PERKOS_CHAT_INTERNAL_URL}/internal/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.CHAT_INTERNAL_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      walletAddress: input.wallet,
      convId: input.convId ?? `project-${input.projectId}`,
      from: senderIdentity(input.sender),
      text: input.text,
      targets: input.targets,
      event: input.event,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    delivered?: number;
    error?: { message?: string };
  };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message ?? `PerkOS-Chat returned ${response.status}`);
  }
  return { id: payload.id, delivered: payload.delivered ?? 0 };
}
