import path from "node:path";
import type { Rule } from "../engine/types.js";
import { changeRequirements, changeTasks } from "../model.js";

/**
 * Traceability rules read the whole change, not just the current document, so
 * they must run exactly once per change. Each guards on the document it is
 * anchored to and returns early otherwise.
 */

export const uniqueRequirementIds: Rule = {
  id: "unique-requirement-ids",
  description: "Two requirements must not share an id.",
  defaultSeverity: "error",
  check(doc, ctx) {
    // Scope is the change, not the file. A change routinely splits its specs
    // across specs/<capability>/spec.md, and a task citing REQ-001 cannot tell
    // two files apart -- so a collision between them is exactly as broken as
    // one inside a single file.
    const all = ctx.change.documents.flatMap((d) => d.requirements.map((r) => ({ req: r, doc: d })));
    for (const req of doc.requirements) {
      if (!req.id) continue;
      const first = all.find((e) => e.req.id === req.id);
      if (!first || first.req === req) continue; // this one is the original
      const where =
        first.doc.path === doc.path
          ? `line ${first.req.span.line}`
          : `${path.relative(ctx.change.root, first.doc.path).split(path.sep).join("/")} line ${first.req.span.line}`;
      ctx.report({
        message: `Duplicate requirement id "${req.id}" (also at ${where}).`,
        span: req.span,
        hint: "Ids are how tasks, tests and commits point back here. Duplicates silently merge two requirements.",
      });
    }
  },
};

export const tasksReferenceRequirements: Rule = {
  id: "tasks-reference-requirements",
  description: "Every task must name the requirement it implements.",
  defaultSeverity: "warn",
  appliesTo: ["tasks"],
  check(doc, ctx) {
    const known = new Set(changeRequirements(ctx.change).flatMap((r) => (r.id ? [r.id] : [])));
    // Nothing to point at.
    if (known.size === 0) return;
    // Citing requirements from tasks is a discipline a team opts into, not
    // something any spec format mandates -- OpenSpec's tasks.md never does it.
    // Stay silent unless some task already cites one, in which case the
    // uncited tasks are a real inconsistency.
    if (!changeTasks(ctx.change).some((t) => t.refs.length > 0)) return;
    for (const task of doc.tasks) {
      if (task.refs.length > 0) continue;
      ctx.report({
        message: `Task "${task.text.slice(0, 60)}" is not linked to a requirement.`,
        span: task.span,
        hint: "Append the requirement id, e.g. \"(REQ-004)\". Unlinked tasks are how scope creep enters.",
      });
    }
  },
};

export const noDanglingReferences: Rule = {
  id: "no-dangling-references",
  description: "Tasks must not reference requirement ids that do not exist.",
  defaultSeverity: "error",
  appliesTo: ["tasks"],
  check(doc, ctx) {
    const known = new Set(changeRequirements(ctx.change).flatMap((r) => (r.id ? [r.id] : [])));
    if (known.size === 0) return;
    for (const task of doc.tasks) {
      for (const ref of task.refs) {
        if (known.has(ref)) continue;
        ctx.report({
          message: `Task references "${ref}", which is not defined in this change.`,
          span: task.span,
          hint: "Either the id is a typo or the requirement was never written down.",
        });
      }
    }
  },
};

export const requirementsHaveTasks: Rule = {
  id: "requirements-have-tasks",
  description: "Every requirement must be covered by at least one task.",
  defaultSeverity: "warn",
  appliesTo: ["spec"],
  check(doc, ctx) {
    const tasks = changeTasks(ctx.change);
    // Only meaningful once a tasks document exists in this change.
    if (tasks.length === 0) return;
    // The mirror of tasks-reference-requirements: if no task cites anything,
    // the project has not adopted the convention and every requirement would
    // look orphaned. Coverage is only measurable once citations exist.
    if (!tasks.some((t) => t.refs.length > 0)) return;
    const covered = new Set(tasks.flatMap((t) => t.refs));
    for (const req of doc.requirements) {
      if (!req.id || covered.has(req.id)) continue;
      ctx.report({
        message: `Requirement "${req.id}" has no task implementing it.`,
        span: req.span,
        hint: "Either add a task or move the requirement out of this change. Orphans ship as silently missing behaviour.",
      });
    }
  },
};

export const traceabilityRules: Rule[] = [
  uniqueRequirementIds,
  tasksReferenceRequirements,
  noDanglingReferences,
  requirementsHaveTasks,
];
