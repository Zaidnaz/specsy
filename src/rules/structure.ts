import type { Rule } from "../engine/types.js";
import { readLines } from "../markdown.js";

/** Placeholders that mean "not written yet" but pass a human skim. */
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX|\?\?\?|WIP|COMING SOON|FILL ME IN|LOREM IPSUM)\b/i;
/** Angle-bracket template slots left unfilled, e.g. `<describe the change>`. */
const UNFILLED_SLOT = /<[a-z][a-z0-9 _-]{3,}>/i;
/** Concrete implementation vocabulary that does not belong in a requirement. */
const IMPLEMENTATION = /\b(redis|postgres|mysql|mongodb|kafka|rabbitmq|s3|dynamodb|nginx|docker|kubernetes|react|vue|svelte|express|fastapi|django|flask|lambda|useState|useEffect)\b/i;

/** Sections each document kind is expected to carry. */
const REQUIRED_SECTIONS: Record<string, RegExp[]> = {
  proposal: [/^(why|motivation|problem|context|background)/i, /^(what|changes?|proposal|solution)/i],
  design: [/^(decision|approach|design|architecture)/i],
};

export const noPlaceholders: Rule = {
  id: "no-placeholders",
  description: "Flags TODO/TBD markers and unfilled template slots.",
  defaultSeverity: "error",
  check(doc, ctx) {
    for (const line of readLines(doc.raw)) {
      if (line.inCode) continue;
      const m = PLACEHOLDER.exec(line.text) ?? UNFILLED_SLOT.exec(line.text);
      if (!m) continue;
      ctx.report({
        message: `Unfinished spec: "${m[0].trim()}".`,
        span: { file: doc.path, line: line.number, column: (m.index ?? 0) + 1, text: line.text },
        hint: "An agent will happily implement around a TBD and invent the missing decision.",
      });
    }
  },
};

export const noEmptySections: Rule = {
  id: "no-empty-sections",
  description: "Flags headings with no content beneath them.",
  defaultSeverity: "warn",
  check(doc, ctx) {
    for (let i = 0; i < doc.sections.length; i++) {
      const sec = doc.sections[i]!;
      const next = doc.sections[i + 1];
      // A parent heading whose body is empty but which has subsections is fine.
      if (next && next.level > sec.level) continue;
      if (sec.body.trim() !== "") continue;
      ctx.report({
        message: `Section "${sec.title}" is empty.`,
        span: sec.span,
        hint: "Fill it in or delete the heading. An empty heading reads as an answered question.",
      });
    }
  },
};

export const requireSections: Rule = {
  id: "require-sections",
  description: "Checks that each document kind carries the sections its format expects.",
  defaultSeverity: "warn",
  appliesTo: ["proposal", "design"],
  check(doc, ctx) {
    const required = REQUIRED_SECTIONS[doc.kind];
    if (!required) return;
    const titles = doc.sections.map((s) => s.title);
    for (const pattern of required) {
      if (titles.some((t) => pattern.test(t))) continue;
      const label = pattern.source.replace(/[^a-z|]/gi, "").split("|")[0];
      ctx.report({
        message: `${doc.kind} is missing a "${label}" section.`,
        span: { file: doc.path, line: 1 },
        hint: `Add a heading covering ${label}. Reviewers and agents both look for it first.`,
      });
    }
  },
};

export const noImplementationInRequirements: Rule = {
  id: "no-implementation-in-requirements",
  description: "Requirements should say what, not which library.",
  defaultSeverity: "warn",
  appliesTo: ["spec"],
  check(doc, ctx) {
    for (const req of doc.requirements) {
      const m = IMPLEMENTATION.exec(req.text);
      if (!m) continue;
      ctx.report({
        message: `Requirement names a specific technology ("${m[0]}").`,
        span: req.span,
        hint: "Move the choice to design.md and state the observable behaviour here. Otherwise the spec has to change when the stack does.",
      });
    }
  },
};

export const structureRules: Rule[] = [
  noPlaceholders,
  noEmptySections,
  requireSections,
  noImplementationInRequirements,
];
