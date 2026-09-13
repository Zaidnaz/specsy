#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import pc from "picocolors";
import { detectAdapter, getAdapter, adapters } from "./adapters/index.js";
import { loadConfig, validateConfig } from "./engine/config.js";
import { lint, resolveConfig } from "./engine/lint.js";
import { allRules } from "./rules/index.js";
import { formatPretty } from "./report/pretty.js";
import { formatJson } from "./report/json.js";
import { formatGithub } from "./report/github.js";
import { measure, formatFootprint } from "./footprint.js";
import { explainRule, nearestRules, distance } from "./explain.js";
import { existsSync, statSync } from "node:fs";

function isDirectory(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const program = new Command();

/** Every subcommand, for the help screen and for did-you-mean suggestions. */
const COMMANDS: { name: string; blurb: string; when: string }[] = [
  { name: "(no command)", blurb: "lint the specs in a directory", when: "You have written or edited a spec and want it checked before implementing." },
  { name: "rules", blurb: "list every rule and what it catches", when: "You are about to write your first spec and want to know the bar." },
  { name: "explain", blurb: "explain one rule, with a failing and a passing example", when: "A finding is unclear and you want to see what good looks like." },
  { name: "footprint", blurb: "token cost of each change, across an agent loop", when: "A change feels large and you want to know what re-reading it costs." },
  { name: "mcp", blurb: "serve the rules to an AI agent over MCP", when: "You want the agent to lint and fix its own specs, with no human relaying output." },
];

program
  .name("specsy")
  .description("A linter for specifications. Catches vague, untestable and untraceable requirements before an agent turns them into code.")
  .version("0.2.3")
  .showSuggestionAfterError()
  .addHelpText(
    "after",
    [
      "",
      "When to use what:",
      ...COMMANDS.map((c) => `  ${pc.bold(c.name.padEnd(12))} ${c.when}`),
      "",
      "Examples:",
      "  specsy                                     lint the current project",
      "  specsy openspec/ --quiet                   errors only",
      "  specsy rules                               see all 16 rules",
      "  specsy explain no-weasel-words             learn one rule, with examples",
      "  specsy footprint --turns 12                context cost over a 12-turn loop",
      "  specsy --reporter github --max-warnings 0  fail CI on any finding",
      "  claude mcp add specsy -- npx -y specsy mcp let an agent lint its own specs",
      "",
      "Exit codes:  0 = no errors   1 = errors, or warnings over --max-warnings   2 = specsy could not run",
      "Docs: https://github.com/Zaidnaz/specsy",
    ].join("\n"),
  );

program
  .argument("[path]", "directory holding the specs", ".")
  .option("-f, --format <name>", `adapter to use (${adapters.map((a) => a.name).join(", ")}, or auto)`)
  .option("-r, --reporter <name>", "output format: pretty, json, github", "pretty")
  .option("--max-warnings <n>", "exit non-zero when warnings exceed this count", (v) => Number.parseInt(v, 10))
  .option("--quiet", "print errors only; warnings are still counted for the exit code", false)
  .action(async (target: string, opts) => {
    const cwd = process.cwd();

    // `specsy validate` and `specsy footprnt` used to be taken as directory
    // names and reported as "no spec format detected in .../validate", which
    // sends someone hunting for a spec problem they do not have. A bare word
    // that is not a directory is far more likely to be a mistyped command.
    if (target !== "." && !/[\/.:]/.test(target) && !isDirectory(target)) {
      const known = COMMANDS.map((c) => c.name).filter((n) => n !== "(no command)");
      console.error(pc.red(`Unknown command "${target}".`));
      const near = known
        .map((n) => ({ n, d: distance(target, n) }))
        .filter((e) => e.d <= 3)
        .sort((a, b) => a.d - b.d);
      console.error("");
      if (near.length > 0) console.error(`Did you mean:  specsy ${near[0]!.n}`);
      console.error(`Commands:      ${known.join("  ")}`);
      console.error("");
      console.error(pc.dim("Run 'specsy --help' to see what each one is for."));
      console.error(pc.dim(`If you meant a directory, it does not exist: ${path.resolve(target)}`));
      process.exitCode = 2;
      return;
    }

    // An unknown reporter used to fall through to pretty output and exit 0.
    // A CI job asking for `--reporter github` would quietly lose its
    // annotations with nothing to indicate anything was wrong.
    const REPORTERS = ["pretty", "json", "github"];
    if (!REPORTERS.includes(opts.reporter)) {
      console.error(pc.red(`Unknown reporter "${opts.reporter}". Known reporters: ${REPORTERS.join(", ")}.`));
      process.exitCode = 2;
      return;
    }

    const { config: fileConfig, path: configPath } = await loadConfig(cwd);
    const configErrors = validateConfig(fileConfig, allRules);
    if (configErrors.length > 0) {
      console.error(pc.red(`Invalid config in ${configPath ?? "(config)"}:`));
      for (const e of configErrors) console.error(`  ${e}`);
      console.error("");
      console.error(pc.dim("A config file is a statement of intent, so specsy refuses rather than ignoring it."));
      process.exitCode = 2;
      return;
    }
    const config = resolveConfig(fileConfig);
    const requested = opts.format ?? config.format ?? "auto";
    const adapter = requested === "auto" ? await detectAdapter(target) : getAdapter(requested);

    if (!adapter) {
      const known = adapters.map((a) => a.name).join(", ");
      if (requested === "auto") {
        // The common first run is someone typing `npx specsy` in their home
        // directory, so say what was looked for and what to do next.
        console.error(pc.red(`No spec format detected in "${path.resolve(target)}".`));
        console.error("");
        console.error("specsy auto-detects an OpenSpec layout: an openspec/ or changes/ directory.");
        console.error("");
        console.error("  Run it inside a project that has one:");
        console.error(pc.dim("      cd my-project && specsy"));
        console.error("");
        console.error("  Or lint any folder of markdown specs explicitly:");
        console.error(pc.dim("      specsy ./docs --format generic"));
      } else {
        console.error(pc.red(`Unknown format "${requested}". Known formats: ${known}.`));
      }
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

    // The one question worth asking once, in one place: did this run actually
    // examine anything? Two separate defects were instances of it -- an
    // `ignore` that matched every file, and (once scoping lands) a selection
    // that matches no change. A gate that passes because it checked nothing
    // is worse than a gate that fails.
    if (result.documentCount === 0) {
      console.error(pc.red("Nothing was examined: every document was excluded."));
      console.error("");
      if ((config.ignore ?? []).length > 0) {
        console.error(`  "ignore" in your config matched every file: ${JSON.stringify(config.ignore)}`);
      }
      console.error(pc.dim("Exiting 2 rather than reporting success, so a CI gate cannot pass by checking nothing."));
      process.exitCode = 2;
      return;
    }

    const reportOpts = { hideWarnings: Boolean(opts.quiet) };
    const reporter = opts.reporter as string;
    if (reporter === "json") console.log(formatJson(result, cwd, reportOpts));
    else if (reporter === "github") console.log(formatGithub(result, cwd, reportOpts));
    else {
      if (configPath) console.log(pc.dim(`config: ${configPath}`));
      console.log(formatPretty(result, cwd, reportOpts));
    }

    const overWarnings = typeof opts.maxWarnings === "number" && result.warnCount > opts.maxWarnings;
    if (result.errorCount > 0 || overWarnings) process.exitCode = 1;
  });

program
  .command("explain")
  .description("explain one rule, with a failing and a passing example")
  .argument("<rule>", "rule id, e.g. no-weasel-words (see: specsy rules)")
  .action((rule: string) => {
    const body = explainRule(rule);
    if (body) {
      console.log(body);
      return;
    }
    console.error(pc.red(`No rule named "${rule}".`));
    const near = nearestRules(rule);
    if (near.length > 0) {
      console.error("");
      console.error(`Did you mean:  ${near.join("  ")}`);
    }
    console.error("");
    console.error(pc.dim("Run 'specsy rules' to list all 16."));
    process.exitCode = 2;
  });

program
  .command("mcp")
  .description("run specsy as an MCP server over stdio, so agents can lint their own specs")
  .action(async () => {
    // stdout is the MCP transport: anything written there that is not a
    // protocol frame corrupts the stream. Diagnostics go to stderr only.
    const { runStdioServer } = await import("./mcp/server.js");
    await runStdioServer();
  });

program
  .command("footprint")
  .description("report how many tokens each change occupies, and what that costs across a loop")
  .argument("[path]", "directory holding the specs", ".")
  .option("-f, --format <name>", "adapter to use")
  .option("--turns <n>", "agent turns to project the loop cost over", (v) => Number.parseInt(v, 10), 8)
  .option("--exact", "use the Anthropic count_tokens endpoint instead of a local estimate", false)
  .option("--model <id>", "model to price against", "claude-opus-5")
  .action(async (target: string, opts) => {
    const requested = opts.format ?? "auto";
    const adapter = requested === "auto" ? await detectAdapter(target) : getAdapter(requested);
    if (!adapter) {
      console.error(pc.red(`No spec format detected in "${path.resolve(target)}".`));
      process.exitCode = 2;
      return;
    }
    const project = await adapter.load(target);
    const fp = await measure(project, { exact: opts.exact, model: opts.model, turns: opts.turns });
    console.log(formatFootprint(fp, process.cwd()));
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
    console.log(pc.dim(`\n${allRules.length} rules. Override any of them in .specsyrc.json under "rules".`));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(pc.red(err instanceof Error ? err.message : String(err)));
  process.exitCode = 2;
});
