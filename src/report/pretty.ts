import path from "node:path";
import pc from "picocolors";
import type { LintResult } from "../engine/lint.js";

export interface ReportOptions {
  /**
   * Print errors only. A display concern: the warnings are still found, still
   * counted, and still decide the exit code alongside --max-warnings.
   */
  hideWarnings?: boolean;
}

export function formatPretty(result: LintResult, cwd: string, opts: ReportOptions = {}): string {
  const out: string[] = [];
  const shown = opts.hideWarnings
    ? result.diagnostics.filter((d) => d.severity === "error")
    : result.diagnostics;
  const byFile = new Map<string, typeof result.diagnostics>();
  for (const d of shown) {
    const list = byFile.get(d.span.file) ?? [];
    list.push(d);
    byFile.set(d.span.file, list);
  }

  for (const [file, diags] of byFile) {
    out.push(pc.underline(path.relative(cwd, file).replace(/\\/g, "/")));
    const width = Math.max(...diags.map((d) => `${d.span.line}:${d.span.column ?? 1}`.length));
    for (const d of diags) {
      const loc = `${d.span.line}:${d.span.column ?? 1}`.padEnd(width);
      const level = d.severity === "error" ? pc.red("error") : pc.yellow(" warn");
      out.push(`  ${pc.dim(loc)}  ${level}  ${d.message}  ${pc.dim(d.rule)}`);
      if (d.hint) out.push(`  ${" ".repeat(width)}         ${pc.dim("→ " + d.hint)}`);
    }
    out.push("");
  }

  const { errorCount, warnCount } = result;
  const total = errorCount + warnCount;
  if (total === 0) {
    out.push(pc.green(`✔ No problems in ${result.documentCount} document(s).`));
  } else if (opts.hideWarnings && errorCount === 0) {
    // Saying "no problems" here would be a lie: warnings were found, and with
    // --max-warnings they may still fail the run.
    out.push(
      pc.green(`✔ No errors in ${result.documentCount} document(s).`) +
        pc.dim(` (${warnCount} warning(s) hidden by --quiet)`),
    );
  } else {
    const parts = [`${errorCount} error${errorCount === 1 ? "" : "s"}`, `${warnCount} warning${warnCount === 1 ? "" : "s"}`];
    const mark = errorCount > 0 ? pc.red("✖") : pc.yellow("▲");
    const hidden = opts.hideWarnings && warnCount > 0 ? pc.dim(` (${warnCount} hidden by --quiet)`) : "";
    out.push(
      `${mark} ${total} problem${total === 1 ? "" : "s"} (${parts.join(", ")}) in ${result.documentCount} document(s).${hidden}`,
    );
  }
  return out.join("\n");
}
