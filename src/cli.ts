#!/usr/bin/env node
import process from "node:process";
import { Command } from "commander";
import pc from "picocolors";
import { detectAdapter, getAdapter, adapters } from "./adapters/index.js";
import { loadConfig } from "./engine/config.js";
import { lint, resolveConfig } from "./engine/lint.js";
import { allRules } from "./rules/index.js";
import { formatPretty } from "./report/pretty.js";
import { formatJson } from "./report/json.js";
import { formatGithub } from "./report/github.js";

const program = new Command();

program
  .name("spec-lint")
  .description("A linter for specifications. Catches vague, untestable and untraceable requirements before an agent turns them into code.")
  .version("0.1.0");

program
  .argument("[path]", "directory holding the specs", ".")
  .option("-f, --format <name>", `adapter to use (${adapters.map((a) => a.name).join(", ")}, or auto)`)
  .option("-r, --reporter <name>", "output format: pretty, json, github", "pretty")
  .option("--max-warnings <n>", "exit non-zero when warnings exceed this count", (v) => Number.parseInt(v, 10))
  .option("--quiet", "report errors only", false)
  .action(async (target: string, opts) => {
    const cwd = process.cwd();
    const { config: fileConfig, path: configPath } = await loadConfig(cwd);
    const config = resolveConfig(fileConfig);
    if (opts.quiet) {
      config.rules = { ...config.rules };
      for (const rule of allRules) {
        if (rule.defaultSeverity === "warn" && !fileConfig.rules?.[rule.id]) config.rules[rule.id] = "off";
      }
    }

    const requested = opts.format ?? config.format ?? "auto";
    const adapter = requested === "auto" ? await detectAdapter(target) : getAdapter(requested);

    if (!adapter) {
      const known = adapters.map((a) => a.name).join(", ");
      console.error(
        requested === "auto"
          ? pc.red(`No spec format detected in "${target}". Pass --format <${known}> to force one.`)
          : pc.red(`Unknown format "${requested}". Known formats: ${known}.`),
      );
      process.exitCode = 2;
      return;
    }

    const project = await adapter.load(target);
    if (project.changes.length === 0) {
      console.error(pc.yellow(`No spec documents found in "${target}" (read as ${adapter.label}).`));
      process.exitCode = 2;
      return;
    }

    const result = lint(project, config);
    const reporter = opts.reporter as string;
    if (reporter === "json") console.log(formatJson(result, cwd));
    else if (reporter === "github") console.log(formatGithub(result, cwd));
    else {
      if (configPath) console.log(pc.dim(`config: ${configPath}`));
      console.log(formatPretty(result, cwd));
    }

    const overWarnings = typeof opts.maxWarnings === "number" && result.warnCount > opts.maxWarnings;
    if (result.errorCount > 0 || overWarnings) process.exitCode = 1;
  });

program
  .command("rules")
  .description("list every rule and its default severity")
  .action(() => {
    const width = Math.max(...allRules.map((r) => r.id.length));
    for (const rule of allRules) {
      const sev = rule.defaultSeverity === "error" ? pc.red("error") : pc.yellow(" warn");
      const scope = rule.appliesTo ? pc.dim(` [${rule.appliesTo.join(", ")}]`) : "";
      console.log(`${pc.bold(rule.id.padEnd(width))}  ${sev}  ${rule.description}${scope}`);
    }
    console.log(pc.dim(`\n${allRules.length} rules. Override any of them in .spec-lintrc.json under "rules".`));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(pc.red(err instanceof Error ? err.message : String(err)));
  process.exitCode = 2;
});
