import type { Rule } from "../engine/types.js";
import { findSection } from "../markdown.js";

const NON_GOALS = [/non[- ]?goals?/i, /out[- ]of[- ]scope/i, /not (?:doing|included|in scope)/i, /^exclusions?/i];

export const requireNonGoals: Rule = {
  id: "require-non-goals",
  description: "Proposals must state what they are deliberately not doing.",
  defaultSeverity: "warn",
  appliesTo: ["proposal"],
  check(doc, ctx) {
    if (findSection(doc.sections, NON_GOALS)) return;
    ctx.report({
      message: "Proposal has no non-goals section.",
      span: { file: doc.path, line: 1 },
      hint: "Add \"## Non-Goals\". An unbounded scope is the single most common cause of an agent building the wrong thing.",
    });
  },
};

export const requireRequirementIds: Rule = {
  id: "require-requirement-ids",
  description: "Requirements need stable ids so tasks, tests and commits can cite them.",
  defaultSeverity: "warn",
  appliesTo: ["spec"],
  check(doc, ctx) {
    for (const req of doc.requirements) {
      if (req.id) continue;
      ctx.report({
        message: `Requirement "${req.sectionTitle ?? req.text.slice(0, 50)}" has no id.`,
        span: req.span,
        hint: "Prefix it with an id like REQ-001. Without one, nothing downstream can point back at this requirement.",
      });
    }
  },
};

export const scopeRules: Rule[] = [requireNonGoals, requireRequirementIds];
