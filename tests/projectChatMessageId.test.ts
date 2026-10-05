import { describe, expect, it } from "vitest";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.JWT_SHARED_SECRET = "a".repeat(40);

const { projectChatMessageId } = await import("../src/projectChat.js");

const post = { projectId: "p1", sender: "Seoul-Beans-Content-Writer", text: "Calendar is ready." };
const t0 = Date.UTC(2026, 9, 5, 0, 0, 10);

describe("projectChatMessageId", () => {
  it("deduplicates a retried post in the same minute", () => {
    expect(projectChatMessageId(post, t0)).toBe(projectChatMessageId(post, t0 + 30_000));
    expect(projectChatMessageId(post, t0)).toMatch(/^tools-[0-9a-f]{32}$/);
  });

  it("treats the same words later or from someone else as a new message", () => {
    expect(projectChatMessageId(post, t0)).not.toBe(projectChatMessageId(post, t0 + 120_000));
    expect(projectChatMessageId(post, t0)).not.toBe(projectChatMessageId({ ...post, sender: "Seoul-Beans-SEO-Specialist" }, t0));
  });
});
