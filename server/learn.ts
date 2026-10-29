// Self-improving rules & skills engine (ADR 0020).
// Distills player thumbs-up/down feedback and verifier auto-fixes via Muse Spark
// (reasoning_effort: "minimal") into persistent rules (server/learned/rules.json +
// RULES.md) and reusable skills (server/learned/skills/<slug>.md), and formats
// compact prompt blocks for Router, Wonder, and Muse Image.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Look } from "../src/contract";
import { activeLogFile } from "./createlog";
import { chat, SPARK } from "./meta";

export type RuleSubsystem = "router" | "wonder" | "art";

export interface LearnedRule {
  id: string;
  subsystem: RuleSubsystem;
  rule: string;
  source: "feedback" | "autofix" | "seed";
  modId?: string;
  command?: string;
  note?: string;
  clearArt?: boolean;
  createdAt: string;
}

export interface LearnedSkill {
  slug: string;
  title: string;
  keywords: string[];
  summary: string;
  snippet: string;
  modId?: string;
  createdAt: string;
}

export interface FeedbackInput {
  modId: string;
  title?: string;
  entityType?: string;
  vote: "up" | "down";
  note: string;
  command?: string;
  source?: string;
  hasArt?: boolean;
  look?: Look;
}

export interface DistilledFeedbackRule {
  rule: LearnedRule;
  clearArt: boolean;
  editInstruction: string;
}

export const DEFAULT_LEARNED_DIR = join(process.cwd(), "server", "learned");
export const MAX_RULES = 24;

let overrideLearnedDir: string | null = null;

/** Override the learned directory (used by unit tests to stay isolated). */
export function setLearnedDir(dir: string | null): void {
  overrideLearnedDir = dir;
}

export function resolveLearnedDir(dir?: string): string {
  return dir ?? overrideLearnedDir ?? DEFAULT_LEARNED_DIR;
}

function rulesJsonPath(dir?: string): string {
  return join(resolveLearnedDir(dir), "rules.json");
}

function rulesMdPath(dir?: string): string {
  return join(resolveLearnedDir(dir), "RULES.md");
}

function skillsDirPath(dir?: string): string {
  return join(resolveLearnedDir(dir), "skills");
}

function logLearn(rec: Record<string, unknown>): void {
  try {
    const file = activeLogFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ kind: "learn", ts: new Date().toISOString(), ...rec }) + "\n");
  } catch {
    /* logging must never break learning or builds */
  }
}

export function sanitizeSlug(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 48) || "skill";
}

function normalizeRuleText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "when", "never", "always", "use", "must", "should", "not"]);
  return new Set(
    normalizeRuleText(text)
      .split(" ")
      .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP.has(w)),
  );
}

function rulesAreSimilar(a: string, b: string): boolean {
  const na = normalizeRuleText(a);
  const nb = normalizeRuleText(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const wa = wordSet(a);
  const wb = wordSet(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union > 0 && inter / union >= 0.78;
}

/** Deduplicate similar rules and cap total count so injected prompts stay lean. */
export function dedupAndCapRules(existing: LearnedRule[], incoming: LearnedRule, maxRules = MAX_RULES): LearnedRule[] {
  const filtered = existing.filter((r) => !(r.subsystem === incoming.subsystem && rulesAreSimilar(r.rule, incoming.rule)));
  filtered.push(incoming);
  while (filtered.length > maxRules) {
    const nonSeedIdx = filtered.findIndex((r) => r.source !== "seed");
    if (nonSeedIdx >= 0 && nonSeedIdx < filtered.length - 1) filtered.splice(nonSeedIdx, 1);
    else filtered.shift();
  }
  return filtered;
}

export function renderRulesMarkdown(rules: LearnedRule[]): string {
  const bySub: Record<RuleSubsystem, LearnedRule[]> = { router: [], wonder: [], art: [] };
  for (const r of rules) {
    const sub: RuleSubsystem = r.subsystem === "router" || r.subsystem === "art" ? r.subsystem : "wonder";
    bySub[sub].push(r);
  }
  const section = (title: string, list: LearnedRule[]): string => {
    if (list.length === 0) return `## ${title}\n\n_(none yet)_\n`;
    return `## ${title}\n\n` + list.map((r) => `- **[${r.source}]** ${r.rule}${r.modId ? ` _(from \`${r.modId}\`)_` : ""}`).join("\n") + "\n";
  };
  return [
    "# Learned Engine Rules",
    "",
    "Automatically distilled by Muse Spark (`muse-spark-1.2`, `reasoning_effort: \"minimal\"`) from in-game player feedback and verifier auto-fixes.",
    "",
    section("Router & Visual Classification (`router`)", bySub.router),
    section("Mod Generation & Physics (`wonder`)", bySub.wonder),
    section("Sprite Sheet & Art Generation (`art`)", bySub.art),
  ].join("\n");
}

export function loadRules(dir?: string): LearnedRule[] {
  try {
    const file = rulesJsonPath(dir);
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { rules?: unknown }).rules)
        ? (raw as { rules: unknown[] }).rules
        : [];
    return list
      .filter((r): r is LearnedRule => Boolean(r && typeof r === "object" && typeof (r as LearnedRule).rule === "string"))
      .map((r) => ({
        id: typeof r.id === "string" && r.id ? r.id : `rule-${Date.now()}`,
        subsystem: r.subsystem === "router" || r.subsystem === "art" ? r.subsystem : "wonder",
        rule: r.rule.trim(),
        source: r.source === "feedback" || r.source === "autofix" || r.source === "seed" ? r.source : "feedback",
        ...(r.modId ? { modId: r.modId } : {}),
        ...(r.command ? { command: r.command } : {}),
        ...(r.note ? { note: r.note } : {}),
        ...(typeof r.clearArt === "boolean" ? { clearArt: r.clearArt } : {}),
        createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

export function saveRules(rules: LearnedRule[], dir?: string): void {
  try {
    const targetDir = resolveLearnedDir(dir);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(rulesJsonPath(dir), JSON.stringify(rules, null, 2) + "\n", "utf8");
    writeFileSync(rulesMdPath(dir), renderRulesMarkdown(rules), "utf8");
  } catch {
    /* disk errors must not crash the server */
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function inferSubsystemFromNote(note: string): { subsystem: RuleSubsystem; clearArt: boolean } {
  const lower = note.toLowerCase();
  const isShapeOrVisual = /\b(shape|circle|ring|triangle|diamond|star|block|pill|primitive|geometric|not a character|not a creature|not a person|not a player|simple ball|effect|particles)\b/.test(lower);
  const isArt = /\b(sprite|art|image|pixel|sheet|magenta|background|cutout|pose|poses|drawn|drawing|scenery)\b/.test(lower);
  if (isShapeOrVisual) return { subsystem: "router", clearArt: true };
  if (isArt) return { subsystem: "art", clearArt: true };
  return { subsystem: "wonder", clearArt: false };
}

function cleanOneLine(text: string, maxLen = 160): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * Distill a thumbs-down player note into a generalizable 1-line rule via Muse Spark,
 * deduplicate/cap, and persist to server/learned/rules.json + RULES.md.
 */
export async function learnRuleFromFeedback(input: FeedbackInput, dir?: string): Promise<DistilledFeedbackRule> {
  const note = cleanOneLine(input.note || "Needs improvement", 240);
  const heur = inferSubsystemFromNote(`${note} ${input.entityType ?? ""}`);
  let subsystem: RuleSubsystem = heur.subsystem;
  let ruleText = "";
  let clearArt = heur.clearArt;
  let editInstruction = `Update "${input.title ?? input.modId}" (${input.modId}) to fix: ${note}`;

  try {
    const res = await chat(
      SPARK,
      [
        {
          role: "system",
          content: [
            "You distill player thumbs-down feedback in a 2D platformer game into one generalizable engine rule so future AI builds never repeat the mistake.",
            "Reply with ONLY a single JSON object, no markdown, no prose:",
            '{"subsystem":"router"|"wonder"|"art","rule":"<concise 1-line imperative rule, max 140 chars>","clearArt":true|false,"editInstruction":"<1-sentence instruction to fix this specific mod right now>"}',
            "Subsystems:",
            '- "router": visual classification rules (e.g. balls, orbs, bubbles, rings, and simple shapes must route with visual:"shape" instead of creature/prop sprite art; weather/fog/rain must route with visual:"effect").',
            '- "art": sprite sheet generation rules (e.g. solid #FF00FF magenta background, separated frames, scenery vs character poses).',
            '- "wonder": mod code, physics, entity sizing, collision, controls, spawning, or gameplay behavior.',
            'Set "clearArt": true if the complaint says an object got unwanted/bad sprite art or should be a code-drawn shape/effect instead of a sprite.',
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Mod: ${input.modId}${input.title ? ` ("${input.title}")` : ""}`,
            input.entityType ? `Entity type clicked: ${input.entityType}` : "",
            input.command ? `Original command: "${input.command}"` : "",
            `Current art: ${input.hasArt ? "sprite sheet attached" : input.look ? `look=${JSON.stringify(input.look)}` : "code-drawn rect"}`,
            `Player thumbs-down note: "${note}"`,
            input.source ? `Mod source excerpt:\n${input.source.slice(0, 1000)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      512,
      "minimal",
    );
    const parsed = extractJsonObject(res.text);
    if (parsed) {
      if (parsed.subsystem === "router" || parsed.subsystem === "wonder" || parsed.subsystem === "art") {
        subsystem = parsed.subsystem;
      }
      if (typeof parsed.rule === "string" && parsed.rule.trim()) {
        ruleText = cleanOneLine(parsed.rule, 150);
      }
      if (typeof parsed.clearArt === "boolean") {
        clearArt = parsed.clearArt || heur.clearArt;
      }
      if (typeof parsed.editInstruction === "string" && parsed.editInstruction.trim()) {
        editInstruction = cleanOneLine(parsed.editInstruction, 240);
      }
    }
  } catch {
    /* fallback below when Spark is unreachable or errors */
  }

  if (!ruleText) {
    const target = input.entityType || input.title || input.modId || "entities";
    ruleText = cleanOneLine(`For ${target}: ${note}`, 150);
  }
  if (subsystem === "router") clearArt = true;

  const entry: LearnedRule = {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subsystem,
    rule: ruleText,
    source: "feedback",
    modId: input.modId,
    ...(input.command ? { command: input.command } : {}),
    note,
    clearArt,
    createdAt: new Date().toISOString(),
  };

  const existing = loadRules(dir);
  const updated = dedupAndCapRules(existing, entry);
  saveRules(updated, dir);
  logLearn({ event: "rule", subsystem: entry.subsystem, rule: entry.rule, modId: input.modId, note, clearArt });

  return { rule: entry, clearArt, editInstruction };
}

function renderSkillMarkdown(skill: LearnedSkill): string {
  return [
    `# ${skill.title}`,
    "",
    `- **Slug:** \`${skill.slug}\``,
    `- **Keywords:** ${skill.keywords.join(", ")}`,
    ...(skill.modId ? [`- **Mod:** \`${skill.modId}\``] : []),
    `- **Learned:** ${skill.createdAt}`,
    "",
    "## Summary",
    skill.summary,
    "",
    "## Reference Pattern",
    "```ts",
    skill.snippet.trim(),
    "```",
    "",
  ].join("\n");
}

export function parseSkillMarkdown(raw: string, fallbackSlug = "skill"): LearnedSkill | null {
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  const slugMatch = raw.match(/^-\s+\*\*Slug:\*\*\s+`?([^`\r\n]+)`?/m);
  const kwMatch = raw.match(/^-\s+\*\*Keywords:\*\*\s+(.+)$/m);
  const modMatch = raw.match(/^-\s+\*\*Mod:\*\*\s+`?([^`\r\n]+)`?/m);
  const learnedMatch = raw.match(/^-\s+\*\*Learned:\*\*\s+(.+)$/m);
  const summaryMatch = raw.match(/##\s+(?:Summary|Why It Works)\s*\r?\n([\s\S]*?)(?=\r?\n##\s+|\s*$)/i);
  const snippetMatch = raw.match(/```(?:ts|typescript|js)?\s*\r?\n([\s\S]*?)\r?\n```/);

  const title = (titleMatch?.[1] ?? fallbackSlug).trim();
  const slug = sanitizeSlug(slugMatch?.[1] ?? fallbackSlug);
  const keywords = (kwMatch?.[1] ?? "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const summary = cleanOneLine(summaryMatch?.[1] ?? "", 260);
  const snippet = (snippetMatch?.[1] ?? "").trim();
  if (!summary && !snippet) return null;
  return {
    slug,
    title,
    keywords: keywords.length > 0 ? keywords : [slug],
    summary: summary || title,
    snippet,
    ...(modMatch?.[1] ? { modId: modMatch[1].trim() } : {}),
    createdAt: learnedMatch?.[1]?.trim() ?? new Date().toISOString(),
  };
}

export function loadSkills(dir?: string): LearnedSkill[] {
  try {
    const sdir = skillsDirPath(dir);
    if (!existsSync(sdir)) return [];
    const files = readdirSync(sdir).filter((f) => f.endsWith(".md")).sort();
    const out: LearnedSkill[] = [];
    for (const f of files) {
      try {
        const raw = readFileSync(join(sdir, f), "utf8");
        const parsed = parseSkillMarkdown(raw, f.replace(/\.md$/, ""));
        if (parsed) out.push(parsed);
      } catch {
        /* ignore unreadable skill file */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function extractCompactSnippet(source: string): string {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  return lines.slice(0, 10).join("\n").slice(0, 480);
}

/**
 * Distill a thumbs-up player rating into a reusable skill file under
 * server/learned/skills/<slug>.md via Muse Spark.
 */
export async function learnSkillFromFeedback(input: FeedbackInput, dir?: string): Promise<LearnedSkill> {
  const note = cleanOneLine(input.note || "Works great", 240);
  const baseWords = `${input.modId} ${input.title ?? ""} ${input.entityType ?? ""} ${input.command ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !["add", "make", "the", "some", "with", "and", "for"].includes(w));

  let slug = sanitizeSlug(input.modId || input.entityType || input.title || "skill");
  let title = input.title || input.modId || "Verified Mod Pattern";
  let keywords = [...new Set(baseWords)].slice(0, 8);
  let summary = note;
  let snippet = input.source ? extractCompactSnippet(input.source) : "";

  try {
    const res = await chat(
      SPARK,
      [
        {
          role: "system",
          content: [
            "You distill a thumbs-up player rating on a verified 2D platformer mod into a reusable skill for future builds.",
            "Reply with ONLY a single JSON object, no markdown, no prose:",
            '{"slug":"<lowercase-hyphen-slug>","title":"<short pattern title>","keywords":["word1","word2","word3"],"summary":"<1-2 sentence mechanics summary explaining why it works>","snippet":"<compact 3-8 line TypeScript excerpt showing the key setup/onTick pattern>"}',
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Mod: ${input.modId}${input.title ? ` ("${input.title}")` : ""}`,
            input.entityType ? `Entity type: ${input.entityType}` : "",
            input.command ? `Command: "${input.command}"` : "",
            `Player thumbs-up note: "${note}"`,
            input.source ? `Verified mod source:\n${input.source.slice(0, 1600)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      768,
      "minimal",
    );
    const parsed = extractJsonObject(res.text);
    if (parsed) {
      if (typeof parsed.slug === "string" && parsed.slug.trim()) slug = sanitizeSlug(parsed.slug);
      if (typeof parsed.title === "string" && parsed.title.trim()) title = cleanOneLine(parsed.title, 80);
      if (Array.isArray(parsed.keywords)) {
        const kws = parsed.keywords
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim().toLowerCase())
          .filter((k) => k.length >= 2);
        keywords = [...new Set([...kws, ...baseWords])].slice(0, 10);
      }
      if (typeof parsed.summary === "string" && parsed.summary.trim()) summary = cleanOneLine(parsed.summary, 240);
      if (typeof parsed.snippet === "string" && parsed.snippet.trim()) snippet = parsed.snippet.trim().slice(0, 520);
    }
  } catch {
    /* fallback below when Spark is unreachable */
  }

  if (keywords.length === 0) keywords = [slug];
  const skill: LearnedSkill = {
    slug,
    title,
    keywords,
    summary,
    snippet,
    modId: input.modId,
    createdAt: new Date().toISOString(),
  };

  try {
    const sdir = skillsDirPath(dir);
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, `${slug}.md`), renderSkillMarkdown(skill), "utf8");
  } catch {
    /* ignore disk write failure */
  }
  logLearn({ event: "skill", slug: skill.slug, title: skill.title, keywords: skill.keywords, modId: input.modId, note });
  return skill;
}

/**
 * Background learner invoked after a build fails attempt 1 verification and runs auto-fix.
 * Extracts a 1-line pitfall rule via Muse Spark and persists it to rules.json + RULES.md.
 * Never throws and never blocks build delivery.
 */
export async function learnFromFix(
  command: string,
  errors: string[],
  badSource: string,
  fixedSource?: string,
  dir?: string,
): Promise<LearnedRule | null> {
  try {
    if (!errors || errors.length === 0) return null;
    const errText = errors.join("; ").slice(0, 400);
    let ruleText = "";
    try {
      const res = await chat(
        SPARK,
        [
          {
            role: "system",
            content: [
              "A 2D platformer mod failed automated verification/playtesting on attempt 1.",
              "Extract ONE concise 1-line generalizable pitfall rule for the mod writer (Wonder) so future builds avoid this failure.",
              "Reply with ONLY a single JSON object, no markdown, no prose:",
              '{"subsystem":"wonder","rule":"<concise 1-line imperative rule, max 140 chars>"}',
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Command: "${command}"`,
              `Verification errors: ${errText}`,
              `Failed source excerpt:\n${badSource.slice(0, 900)}`,
              fixedSource ? `Working fix excerpt:\n${fixedSource.slice(0, 900)}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        512,
        "minimal",
      );
      const parsed = extractJsonObject(res.text);
      if (parsed && typeof parsed.rule === "string" && parsed.rule.trim()) {
        ruleText = cleanOneLine(parsed.rule, 150);
      }
    } catch {
      /* fallback below */
    }
    if (!ruleText) {
      ruleText = cleanOneLine(`Avoid verifier error (${errText.slice(0, 90)}) when building "${command.slice(0, 40)}".`, 150);
    }
    const entry: LearnedRule = {
      id: `autofix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      subsystem: "wonder",
      rule: ruleText,
      source: "autofix",
      command,
      note: errText,
      createdAt: new Date().toISOString(),
    };
    const existing = loadRules(dir);
    const updated = dedupAndCapRules(existing, entry);
    saveRules(updated, dir);
    logLearn({ event: "autofix-rule", rule: entry.rule, command, errors });
    return entry;
  } catch {
    return null;
  }
}

/** Match reusable skills from server/learned/skills/*.md by command keywords. */
export function matchSkills(command: string, dir?: string, maxSkills = 2): LearnedSkill[] {
  if (!command.trim()) return [];
  const skills = loadSkills(dir);
  if (skills.length === 0) return [];
  const cmdLower = command.toLowerCase();
  const cmdTokens = new Set(
    cmdLower
      .replace(/[^a-z0-9\s-]+/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length >= 3 && !["add", "make", "create", "spawn", "build", "the", "some", "with", "and"].includes(w)),
  );
  if (cmdTokens.size === 0) return [];

  const scored: { skill: LearnedSkill; score: number }[] = [];
  for (const skill of skills) {
    let score = 0;
    for (const kw of skill.keywords) {
      const k = kw.toLowerCase().trim();
      if (!k) continue;
      if (cmdTokens.has(k) || (k.length >= 4 && cmdLower.includes(k))) score += 2;
      else {
        for (const tok of cmdTokens) {
          if (tok.length >= 4 && (tok.startsWith(k) || k.startsWith(tok))) {
            score += 1;
            break;
          }
        }
      }
    }
    for (const part of skill.slug.split("-")) {
      if (part.length >= 3 && cmdTokens.has(part)) score += 1;
    }
    if (score > 0) scored.push({ skill, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSkills).map((s) => s.skill);
}

/**
 * Format a compact LEARNED RULES (& LEARNED SKILLS) block for Router, Wonder, or Art prompts.
 * Returns "" when no learned rules or skills apply.
 */
export function formatLearnedBlock(subsystem: RuleSubsystem, command = "", dir?: string): string {
  const allRules = loadRules(dir);
  const rules = allRules.filter((r) => {
    if (subsystem === "wonder") return r.subsystem === "wonder" || r.subsystem === "router";
    return r.subsystem === subsystem;
  });

  const parts: string[] = [];
  if (rules.length > 0) {
    const recent = rules.slice(-12);
    parts.push(
      "LEARNED RULES (from player feedback & past playtests — obey strictly):\n" +
        recent.map((r) => `- ${r.rule}`).join("\n"),
    );
  }

  if (subsystem === "wonder" && command) {
    const matched = matchSkills(command, dir, 2);
    if (matched.length > 0) {
      const skillLines = matched.map((s) => {
        const snip = s.snippet ? `\n  Pattern:\n  ${s.snippet.replace(/\r?\n/g, "\n  ")}` : "";
        return `- ${s.title} (${s.slug}): ${s.summary}${snip}`;
      });
      parts.push("LEARNED SKILLS (verified patterns rated 👍 by the player):\n" + skillLines.join("\n"));
    }
  }

  return parts.join("\n\n");
}
