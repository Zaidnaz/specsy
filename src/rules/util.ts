import type { Requirement, Span } from "../model.js";
import { stripNoise } from "../markdown.js";

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
    yield { text, span: { ...req.span, line: req.span.line + i } };
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
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}
