import type { Rule } from "../engine/types.js";
import { clarityUnits, countMatches, requirementLines, sentences, wordListPattern } from "./util.js";
import { stripNoise } from "../markdown.js";

/**
 * Words that feel like a requirement but commit to nothing. Deliberately
 * conservative: every entry here is one an implementer cannot turn into a
 * test without asking a follow-up question. Extend via `weaselWords` config.
 */
export const WEASEL_WORDS = [
  // Performance adjectives deliberately live in PERF_CLAIM instead, so
  // quantify-performance owns them and reports each one exactly once.
  "robust", "robustly", "resilient", "efficient", "efficiently",
  "user-friendly", "intuitive", "seamless", "seamlessly", "graceful", "gracefully",
  "appropriate", "appropriately", "reasonable", "reasonably", "adequate", "adequately",
  "sufficient", "sufficiently", "proper", "properly", "correctly",
  "simple", "easy", "clean", "nice", "modern", "lightweight", "flexible",
  "as needed", "if necessary", "where applicable", "where appropriate",
  "best practice", "best practices", "industry standard",
  "several", "various", "some", "many", "most", "few",
  "minimal", "optimal", "better", "improved", "enhanced", "comprehensive",
  "significant", "significantly", "substantial", "substantially",
];

/** Performance adjectives that demand a number. */
const PERF_CLAIM = /\b(fast|quickly|slow|responsive|low[- ]latency|high[- ]performance|real[- ]?time|instant(?:ly)?|snappy|scalable|high[- ]throughput)\b/i;
/** Something countable: a magnitude with a unit, or an explicit percentage. */
const QUANTITY = /\b\d+(?:\.\d+)?\s*(?:[a-z-]+\s+){0,2}(?:ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?|rps|qps|tps|req\/s|requests?\/s|%|percent|users?|connections?)(?![a-z])/i;

/** Open-ended list endings. Only a defect when the list really trails off. */
const OPEN_ENDED = /\b(?:etc\.?|and so on|and more|among others)(?=\s*[.,;:)\]]|\s*$)/gi;

const NORMATIVE = /\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|MAY)\b/;
/** Non-normative phrasing that is trying to be a requirement. */
const SOFT_MODAL = /\b(will|would|can|could|needs to|need to|has to|have to|is supposed to|ought to|is expected to)\b/i;
/** Pronouns with no possible antecedent when they open a requirement. */
const LEADING_PRONOUN = /^(it|this|that|these|those|they|there)\b/i;

export const noWeaselWords: Rule = {
  id: "no-weasel-words",
  description: "Flags subjective words that cannot be turned into a test.",
  defaultSeverity: "warn",
  appliesTo: ["spec", "proposal"],
  check(doc, ctx) {
    const pattern = wordListPattern([...WEASEL_WORDS, ...(ctx.config.weaselWords ?? [])]);
    for (const unit of clarityUnits(doc)) {
      for (const { text, span } of unit.lines) {
        for (const m of text.matchAll(pattern)) {
          ctx.report({
            message: `"${m[0]}" is not measurable.`,
            span: { ...span, column: (m.index ?? 0) + 1 },
            hint: `Replace with the observable outcome. What would you check to know "${m[0]}" was achieved?`,
          });
        }
        for (const m of text.matchAll(OPEN_ENDED)) {
          ctx.report({
            message: `"${m[0].trim()}" leaves the list open-ended.`,
            span: { ...span, column: (m.index ?? 0) + 1 },
            hint: "Enumerate the cases that must be handled. An agent cannot implement an unfinished list.",
          });
        }
      }
    }
  },
};

export const quantifyPerformance: Rule = {
  id: "quantify-performance",
  description: "Performance claims must carry a number and a unit.",
  // Warn, not error. The rule matches bare adjectives, so "a fast path
  // through the cache" trips it -- real enough to raise, not certain enough
  // to fail a build. Anyone wanting it strict has --max-warnings 0.
  defaultSeverity: "warn",
  appliesTo: ["spec", "proposal"],
  check(doc, ctx) {
    for (const unit of clarityUnits(doc)) {
      // A budget stated anywhere in the unit covers the whole thing.
      if (QUANTITY.test(unit.text)) continue;
      for (const { text, span } of unit.lines) {
        const m = PERF_CLAIM.exec(text);
        if (!m) continue;
        ctx.report({
          message: `Performance claim "${m[0]}" has no target.`,
          span: { ...span, column: (m.index ?? 0) + 1 },
          hint: "State a budget and a percentile, e.g. \"p95 under 200ms\" or \"sustains 500 rps\".",
        });
        break; // one finding per unit is enough
      }
    }
  },
};

export const useNormativeKeywords: Rule = {
  id: "use-normative-keywords",
  description: "Requirements should use MUST / SHALL / SHOULD / MAY, not soft modals.",
  defaultSeverity: "warn",
  appliesTo: ["spec"],
  check(doc, ctx) {
    for (const req of doc.requirements) {
      if (NORMATIVE.test(req.text)) continue;
      for (const { text, span } of requirementLines(req)) {
        const m = SOFT_MODAL.exec(text);
        if (!m) continue;
        ctx.report({
          message: `"${m[0]}" leaves the obligation unclear.`,
          span: { ...span, column: (m.index ?? 0) + 1 },
          hint: "Use MUST for a hard requirement, SHOULD for a strong default, MAY for an option.",
        });
        break;
      }
    }
  },
};

export const oneRequirementPerStatement: Rule = {
  id: "one-requirement-per-statement",
  description: "Splits requirements that bundle several obligations into one line.",
  defaultSeverity: "warn",
  appliesTo: ["spec"],
  check(doc, ctx) {
    for (const req of doc.requirements) {
      // Join the requirement's lines before splitting into sentences. Checking
      // line by line let a compound sentence escape simply by being wrapped,
      // and made the finding depend on where the author happened to hit enter.
      const lines = [...requirementLines(req)];
      const marks: { start: number; span: typeof lines[number]["span"] }[] = [];
      let offset = 0;
      for (const line of lines) {
        marks.push({ start: offset, span: line.span });
        offset += line.text.length + 1; // the joining space
      }
      const full = lines.map((l) => l.text).join(" ");

      for (const sentence of sentences(full)) {
        if (countMatches(sentence, NORMATIVE) < 2) continue;
        const at = full.indexOf(sentence);
        const mark = [...marks].reverse().find((m) => m.start <= at) ?? marks[0];
        ctx.report({
          message: "This sentence states more than one obligation.",
          ...(mark ? { span: mark.span } : { span: req.span }),
          hint: "Split it. One requirement per statement keeps each independently testable and traceable.",
        });
        break;
      }
    }
  },
};

export const noAmbiguousPronoun: Rule = {
  id: "no-ambiguous-pronoun",
  description: "Flags requirements opening with a pronoun that has no antecedent.",
  defaultSeverity: "warn",
  appliesTo: ["spec"],
  check(doc, ctx) {
    for (const req of doc.requirements) {
      const first = stripNoise(req.text.split("\n")[0] ?? "").trim();
      const m = LEADING_PRONOUN.exec(first);
      if (!m) continue;
      ctx.report({
        message: `Requirement opens with "${m[0]}", which has no antecedent.`,
        span: req.span,
        hint: "Name the actor or component explicitly. A reader arriving from a task link has no preceding sentence.",
      });
    }
  },
};

export const requireAcceptanceCriteria: Rule = {
  id: "require-acceptance-criteria",
  description: "Every requirement needs at least one scenario or acceptance criterion.",
  defaultSeverity: "error",
  appliesTo: ["spec"],
  check(doc, ctx) {
    for (const req of doc.requirements) {
      if (req.criteria.length > 0) continue;
      ctx.report({
        message: `Requirement "${req.sectionTitle ?? req.text.slice(0, 60)}" has no acceptance criteria.`,
        span: req.span,
        hint: "Add at least one WHEN/THEN scenario. Without one, nothing decides whether the code satisfies this.",
      });
    }
  },
};

export const clarityRules: Rule[] = [
  noWeaselWords,
  quantifyPerformance,
  useNormativeKeywords,
  oneRequirementPerStatement,
  noAmbiguousPronoun,
  requireAcceptanceCriteria,
];
