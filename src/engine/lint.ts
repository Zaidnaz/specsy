import type { SpecProject } from "../model.js";
import type { Config, Diagnostic, Rule, RuleContext, Severity } from "./types.js";
import { defaultConfig } from "./types.js";
import { allRules } from "../rules/index.js";

export interface LintResult {
  diagnostics: Diagnostic[];
  errorCount: number;
  warnCount: number;
  documentCount: number;
  ruleCount: number;
  project: SpecProject;
}

export function resolveConfig(user: Config = {}): Config {
  return {
    ...defaultConfig,
    ...user,
    rules: { ...defaultConfig.rules, ...user.rules },
    weaselWords: [...(defaultConfig.weaselWords ?? []), ...(user.weaselWords ?? [])],
    ignore: [...(defaultConfig.ignore ?? []), ...(user.ignore ?? [])],
  };
}

function severityFor(rule: Rule, config: Config): Severity {
  return config.rules?.[rule.id] ?? rule.defaultSeverity;
}

export function lint(project: SpecProject, userConfig: Config = {}, rules: Rule[] = allRules): LintResult {
  const config = resolveConfig(userConfig);
  const diagnostics: Diagnostic[] = [];
  let documentCount = 0;
  const active = rules.filter((r) => severityFor(r, config) !== "off");

  for (const change of project.changes) {
    for (const doc of change.documents) {
      documentCount++;
      for (const rule of active) {
        if (rule.appliesTo && !rule.appliesTo.includes(doc.kind)) continue;
        const severity = severityFor(rule, config) as Exclude<Severity, "off">;
        const ctx: RuleContext = {
          project,
          change,
          config,
          report(d) {
            diagnostics.push({ ...d, rule: rule.id, severity });
          },
        };
        rule.check(doc, ctx);
      }
    }
  }

  diagnostics.sort(
    (a, b) =>
      a.span.file.localeCompare(b.span.file) ||
      a.span.line - b.span.line ||
      (a.span.column ?? 0) - (b.span.column ?? 0) ||
      a.rule.localeCompare(b.rule),
  );

  return {
    diagnostics,
    errorCount: diagnostics.filter((d) => d.severity === "error").length,
    warnCount: diagnostics.filter((d) => d.severity === "warn").length,
    documentCount,
    ruleCount: active.length,
    project,
  };
}
