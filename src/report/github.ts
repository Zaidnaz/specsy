import path from "node:path";
import type { LintResult } from "../engine/lint.js";
import type { ReportOptions } from "./pretty.js";

/** GitHub Actions workflow-command annotations, rendered inline on the PR diff. */
export function formatGithub(result: LintResult, cwd: string, opts: ReportOptions = {}): string {
  const shown = opts.hideWarnings
    ? result.diagnostics.filter((d) => d.severity === "error")
    : result.diagnostics;
  return shown
    .map((d) => {
      const file = path.relative(cwd, d.span.file).replace(/\\/g, "/");
      const level = d.severity === "error" ? "error" : "warning";
      const body = d.hint ? `${d.message} ${d.hint}` : d.message;
      // Newlines and commas would terminate the workflow command early.
      const escaped = body.replace(/\r?\n/g, " ").replace(/%/g, "%25");
      return `::${level} file=${file},line=${d.span.line},col=${d.span.column ?? 1},title=${d.rule}::${escaped}`;
    })
    .join("\n");
}
