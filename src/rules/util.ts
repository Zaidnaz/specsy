import type { Requirement, SpecDocument, Span } from "../model.js";
import { readLines, stripNoise } from "../markdown.js";

/**
 * Walk a requirement line by line, yielding noise-stripped text and a span
 * that points at the true source line. Requirement text is built as
 * `heading\nbody`, so index 0 lands on the heading line and the rest follow.
 */
export function* requirementLines(req: Requirement): Generator<{ text: string; span: Span }> {
  const lines = req.text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = stripNoise(lines[i] ?? "").trim();
    if (!text) continue;
    // Index 0 is the heading. Everything after belongs to the body, which
    // starts at bodyStartLine -- offsetting from the heading skips the blank
    // line almost every spec puts between them, reporting one line short.
    const line =
      i === 0 || req.bodyStartLine === undefined ? req.span.line + i : req.bodyStartLine + i - 1;
    yield { text, span: { ...req.span, line } };
  }
}

/** Split on sentence boundaries, keeping it simple and abbreviation-tolerant. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'`(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Count non-overlapping matches of a global-able pattern. */
export function countMatches(text: string, pattern: RegExp): number {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(re)].length;
}

/** Case-insensitive word-boundary alternation from a word list. */
export function wordListPattern(words: string[]): RegExp {
  const escaped = words.map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  // "how many documents did it cover" asks a question; "many documents"
  // makes a vague claim. The lookbehind keeps the interrogative out.
  return new RegExp(`(?<!\\bhow )\\b(${escaped.join("|")})\\b`, "gi");
}

/**
 * Sections that explain why the change is wanted rather than what will be
 * built. Vague language is legitimate here: "search feels slow" is a problem
 * statement, not an unmeasurable requirement.
 */
const MOTIVATION = /^(why|motivation|background|context|problem|rationale|history)\b/i;

/**
 * A span of text a clarity rule should examine, together with its lines.
 *
 * In a spec the unit is a requirement. In a proposal there are usually no
 * formal requirements at all, so every prose line outside the motivation
 * sections becomes its own unit -- otherwise a proposal written without
 * MUST/SHALL is silently exempt from the rules that matter most.
 */
export interface ClarityUnit {
  text: string;
  span: Span;
  lines: { text: string; span: Span }[];
}

export function clarityUnits(doc: SpecDocument): ClarityUnit[] {
  if (doc.kind !== "proposal") {
    return doc.requirements.map((req) => ({
      text: req.text,
      span: req.span,
      lines: [...requirementLines(req)],
    }));
  }

  const units: ClarityUnit[] = [];
  for (const sec of doc.sections) {
    if (MOTIVATION.test(sec.title)) continue;
    for (const line of readLines(sec.body)) {
      if (line.inCode) continue;
      const text = stripNoise(line.text)
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+[.)]\s+/, "")
        .trim();
      if (!text) continue;
      const span: Span = { file: doc.path, line: sec.bodyStartLine + line.number - 1, text: line.text };
      units.push({ text, span, lines: [{ text, span }] });
    }
  }
  return units;
}
