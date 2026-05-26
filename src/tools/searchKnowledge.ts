/**
 * searchKnowledge(query) → array of {topic, excerpt, score}
 *
 * Lightweight fuzzy search across runbook + (future) /knowledge_base
 * Firestore entries. v1: keyword-overlap scoring across runbook only.
 * v2: pull /knowledge_base curated entries + use proper text search
 * (Algolia / Typesense / Postgres pg_trgm).
 *
 * Read tool — gated by standard JWT auth, no admin tier needed.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { config } from "../config.js";
import type { Tool } from "./types.js";

const InputSchema = z.object({
  query: z.string().min(2).max(200),
  limit: z.number().int().min(1).max(20).default(5),
});

type Hit = { topic: string; excerpt: string; score: number };

type Entry = {
  topic: string;
  body: string;
  /** token → occurrence count (term frequency). */
  termFreq: Map<string, number>;
  /** tokens derived from the topic slug — weighted higher in scoring. */
  topicTokens: Set<string>;
};

let cachedIndex: Entry[] | null = null;

async function loadIndex(): Promise<Entry[]> {
  if (cachedIndex) return cachedIndex;
  const dir = config.RUNBOOK_DIR;
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((e) => e.endsWith(".md"));
  } catch {
    return (cachedIndex = []);
  }
  const out: Entry[] = [];
  for (const file of entries) {
    try {
      const body = await readFile(path.join(dir, file), "utf8");
      const topic = file.replace(/\.md$/, "");
      out.push({
        topic,
        body,
        termFreq: termFrequencies(body),
        topicTokens: new Set(tokens(topic.replace(/^\d+-/, ""))),
      });
    } catch {
      // skip unreadable files
    }
  }
  cachedIndex = out;
  return cachedIndex;
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
}

function termFrequencies(text: string): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function excerptAround(body: string, query: string): string {
  const idx = body.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return body.slice(0, 200).replace(/\s+/g, " ").trim();
  }
  const start = Math.max(0, idx - 80);
  const end = Math.min(body.length, idx + query.length + 120);
  return (start > 0 ? "…" : "") + body.slice(start, end).replace(/\s+/g, " ").trim() + (end < body.length ? "…" : "");
}

export const searchKnowledge: Tool<typeof InputSchema> = {
  name: "searchKnowledge",
  kind: "read",
  role: "user",
  description:
    "Search PerkOS knowledge base + runbook for entries matching a free-text query. Returns ranked hits with excerpts.",
  input: InputSchema,
  async run({ args }) {
    const index = await loadIndex();
    const queryTokens = Array.from(new Set(tokens(args.query)));
    if (queryTokens.length === 0) {
      return { ok: true, data: { hits: [] } };
    }
    const hits: Hit[] = [];
    for (const entry of index) {
      let score = 0;
      for (const t of queryTokens) {
        const tf = entry.termFreq.get(t) ?? 0;
        if (tf === 0) continue;
        // Body term frequency (saturating log to dampen long docs).
        score += 1 + Math.log10(tf);
        // Title/topic-slug bonus — query matching the filename strongly
        // signals the doc is *about* this term, not just mentioning it.
        if (entry.topicTokens.has(t)) score += 3;
      }
      if (score > 0) {
        hits.push({
          topic: entry.topic,
          excerpt: excerptAround(entry.body, args.query),
          score: Number(score.toFixed(3)),
        });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return { ok: true, data: { hits: hits.slice(0, args.limit) } };
  },
};
