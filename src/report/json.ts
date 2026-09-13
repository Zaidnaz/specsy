import path from "node:path";
import type { LintResult } from "../engine/lint.js";
import type { ReportOptions } from "./pretty.js";

export function formatJson(result: LintResult, cwd: string, opts: ReportOptions = {}): string {
  const shown = opts.hideWarnings
    ? result.diagnostics.filter((d) => d.severity === "error")
    : result.diagnostics;
  return JSON.stringify(
    {
      format: result.project.format,
      documentCount: result.documentCount,
      ruleCount: result.ruleCount,
      errorCount: result.errorCount,
      warnCount: result.warnCount,
      diagnostics: shown.map((d) => ({
        rule: d.rule,
        severity: d.severity,
        message: d.message,
        hint: d.hint ?? null,
        file: path.relative(cwd, d.span.file).replace(/\\/g, "/"),
        line: d.span.line,
        column: d.span.column ?? 1,
      })),
    },
    null,
    2,
  );
}
