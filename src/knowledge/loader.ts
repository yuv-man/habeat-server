import * as fs from "fs";
import * as path from "path";

// ─── types ───────────────────────────────────────────────────────────────────

export type KnowledgeAgent =
  | "eating-profile"
  | "meal-generator"
  | "chloe-voice"
  | "chat-ai";

// ─── file registry (mirrors knowledge/_index.md) ─────────────────────────────

const KNOWLEDGE_DIR = path.resolve(process.cwd(), "knowledge");

interface KnowledgeFile {
  path: string;
  agents: KnowledgeAgent[];
  tokensEst: number;
}

const REGISTRY: KnowledgeFile[] = [
  { path: "nutrition/macros-mood.md",     agents: ["eating-profile", "meal-generator", "chat-ai"],     tokensEst: 480 },
  { path: "nutrition/meal-timing.md",     agents: ["meal-generator", "eating-profile", "chat-ai"],     tokensEst: 360 },
  { path: "nutrition/mood-foods.md",      agents: ["meal-generator", "chat-ai"],                       tokensEst: 420 },
  { path: "cbt/emotional-eating.md",      agents: ["eating-profile", "chloe-voice", "chat-ai"],        tokensEst: 500 },
  { path: "cbt/interventions.md",         agents: ["eating-profile", "chloe-voice", "chat-ai"],        tokensEst: 460 },
  { path: "cbt/distortions.md",           agents: ["chat-ai", "chloe-voice"],                          tokensEst: 340 },
  { path: "profile/eating-archetypes.md", agents: ["eating-profile", "meal-generator", "chat-ai"],     tokensEst: 440 },
  { path: "profile/psych-profile.md",     agents: ["eating-profile", "chat-ai"],                       tokensEst: 460 },
];

// ─── strip YAML front matter ─────────────────────────────────────────────────

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("---", 3);
  return end === -1 ? content : content.slice(end + 3).trimStart();
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Load all knowledge files relevant to an agent, within an optional token budget.
 * Returns a single string ready to inject into a prompt.
 */
export function loadKnowledge(
  agent: KnowledgeAgent,
  options: { maxTokens?: number; topics?: string[] } = {}
): string {
  const { maxTokens = 2000, topics } = options;

  const relevant = REGISTRY.filter(
    (f) =>
      f.agents.includes(agent) &&
      (!topics || topics.some((t) => f.path.includes(t)))
  );

  const sections: string[] = [];
  let totalTokens = 0;

  for (const file of relevant) {
    if (totalTokens + file.tokensEst > maxTokens) break;
    const fullPath = path.join(KNOWLEDGE_DIR, file.path);
    if (!fs.existsSync(fullPath)) continue;
    const raw = fs.readFileSync(fullPath, "utf-8");
    const content = stripFrontmatter(raw);
    sections.push(content);
    totalTokens += file.tokensEst;
  }

  if (sections.length === 0) return "";

  return `## PROFESSIONAL KNOWLEDGE BASE\n\n${sections.join("\n\n---\n\n")}`;
}

/**
 * Load a single specific file by its registry path.
 */
export function loadFile(filePath: string): string {
  const fullPath = path.join(KNOWLEDGE_DIR, filePath);
  if (!fs.existsSync(fullPath)) return "";
  const raw = fs.readFileSync(fullPath, "utf-8");
  return stripFrontmatter(raw);
}

/**
 * Estimate total tokens for an agent's full knowledge set.
 */
export function estimateTokens(agent: KnowledgeAgent): number {
  return REGISTRY.filter((f) => f.agents.includes(agent))
    .reduce((sum, f) => sum + f.tokensEst, 0);
}
