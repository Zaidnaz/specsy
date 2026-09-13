import path from "node:path";
import pc from "picocolors";
import type { LintResult } from "../engine/lint.js";

export function formatPretty(result: LintResult, cwd: string): string {
  const out: string[] = [];
  const byFile = new Map<string, typeof result.diagnostics>();
  for (const d of result.diagnostics) {
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
  } else {
    const parts = [`${errorCount} error${errorCount === 1 ? "" : "s"}`, `${warnCount} warning${warnCount === 1 ? "" : "s"}`];
    const mark = errorCount > 0 ? pc.red("✖") : pc.yellow("▲");
    out.push(`${mark} ${total} problem${total === 1 ? "" : "s"} (${parts.join(", ")}) in ${result.documentCount} document(s).`);
  }
  return out.join("\n");
}
