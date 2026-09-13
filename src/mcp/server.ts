/**
 * specsy as an MCP server.
 *
 * Without this, the loop has a human in it: the agent writes a spec, a person
 * runs specsy, reads the output, and pastes it back. Every hand-off is a
 * chance to drop a finding, and it costs a human round trip per iteration.
 *
 * With it the agent lints its own spec, reads the hint, fixes the spec, and
 * re-lints -- before it writes any code. Same 16 rules, no new analysis; the
 * only change is who can reach them.
 *
 * Responses are written for a model, not a terminal: compact, no colour, and
 * every finding carries the hint, because the hint is the part that tells the
 * agent what to actually do.
 */
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { detectAdapter, getAdapter } from "../adapters/index.js";
import { loadConfig } from "../engine/config.js";
import { lint, resolveConfig } from "../engine/lint.js";
import { allRules, getRule } from "../rules/index.js";
import { measure } from "../footprint.js";
import { SessionUsage, formatCost, formatTokens, inputCost } from "../tokens.js";

const usage = new SessionUsage();

/** Text-only tool result, the shape every MCP client understands. */
function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

async function loadProject(root: string, format?: string) {
  const adapter = format && format !== "auto" ? getAdapter(format) : await detectAdapter(root);
  if (!adapter) {
    throw new Error(
      `No spec format detected in "${path.resolve(root)}". specsy looks for an OpenSpec layout ` +
        `(an openspec/ or changes/ directory). Pass format:"generic" to lint any folder of markdown.`,
    );
  }
  return { adapter, project: await adapter.load(root) };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "specsy", version: "0.2.0" });

  server.registerTool(
    "lint_specs",
    {
      title: "Lint specifications",
      description:
        "Check specs for vague, untestable or untraceable requirements before implementing them. " +
        "Run this after writing or editing a spec and before starting implementation. " +
        "Returns each finding with a file, line, and a concrete fix.",
      inputSchema: {
        path: z.string().optional().describe("Directory holding the specs. Defaults to the working directory."),
        format: z.string().optional().describe('Adapter: "openspec", "generic", or "auto" (default).'),
        change: z.string().optional().describe("Limit to a single change id."),
        errors_only: z.boolean().optional().describe("Report errors and skip warnings."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: target, format, change, errors_only }) => {
      const root = target ?? process.cwd();
      const { project } = await loadProject(root, format);

      const selected = change
        ? { ...project, changes: project.changes.filter((c) => c.id === change) }
        : project;
      if (change && selected.changes.length === 0) {
        const known = project.changes.map((c) => c.id).join(", ");
        const body = `No change named "${change}". Available: ${known || "(none)"}.`;
        usage.record("lint_specs", body);
        return text(body);
      }

      const { config: fileConfig } = await loadConfig(root);
      const config = resolveConfig(fileConfig);
      if (errors_only) {
        config.rules = { ...config.rules };
        for (const rule of allRules) {
          if (rule.defaultSeverity === "warn" && !fileConfig.rules?.[rule.id]) {
            config.rules[rule.id] = "off";
          }
        }
      }

      const result = lint(selected, config);
      const lines: string[] = [];

      if (result.diagnostics.length === 0) {
        lines.push(`No problems in ${result.documentCount} document(s). The specs are ready to implement.`);
      } else {
        for (const d of result.diagnostics) {
          const rel = path.relative(root, d.span.file).replace(/\\/g, "/");
          lines.push(`${rel}:${d.span.line}:${d.span.column ?? 1} ${d.severity} [${d.rule}] ${d.message}`);
          if (d.hint) lines.push(`    fix: ${d.hint}`);
        }
        lines.push("");
        lines.push(
          `${result.errorCount} error(s), ${result.warnCount} warning(s) in ${result.documentCount} document(s).`,
        );
        lines.push("Fix these in the spec before implementing. Call explain_rule for any rule you want detail on.");
      }

      const body = lines.join("\n");
      usage.record("lint_specs", body);
      return text(body);
    },
  );

  server.registerTool(
    "explain_rule",
    {
      title: "Explain a specsy rule",
      description:
        "Explain what a rule checks and why, with an example of a spec that fails it and one that passes. " +
        "Call this when a finding is unclear, or to learn what good looks like before writing a spec.",
      inputSchema: {
        rule: z.string().describe('Rule id, e.g. "no-weasel-words". Omit nothing; use list_rules to see them all.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ rule }) => {
      const found = getRule(rule);
      if (!found) {
        const body = `No rule "${rule}". Known rules: ${allRules.map((r) => r.id).join(", ")}.`;
        usage.record("explain_rule", body);
        return text(body);
      }
      const example = EXAMPLES[found.id];
      const lines = [
        `${found.id} (${found.defaultSeverity})`,
        found.description,
        `Applies to: ${(found.appliesTo ?? ["all document kinds"]).join(", ")}.`,
      ];
      if (example) {
        lines.push("", `Why: ${example.why}`, "", `Fails:  ${example.bad}`, `Passes: ${example.good}`);
      }
      const body = lines.join("\n");
      usage.record("explain_rule", body);
      return text(body);
    },
  );

  server.registerTool(
    "list_rules",
    {
      title: "List specsy rules",
      description: "List every rule, its severity and what it catches. Use before writing a spec to know the bar.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const body = allRules
        .map((r) => `${r.id} (${r.defaultSeverity}) — ${r.description}`)
        .join("\n");
      usage.record("list_rules", body);
      return text(body);
    },
  );

  server.registerTool(
    "spec_footprint",
    {
      title: "Measure the context cost of specs",
      description:
        "Report how many tokens each change occupies. A spec is re-read on every turn of an " +
        "implementation loop, so its size is a recurring context cost, not a one-off. " +
        "Use this when a change feels large, or to decide whether to split it.",
      inputSchema: {
        path: z.string().optional().describe("Directory holding the specs."),
        format: z.string().optional().describe('Adapter: "openspec", "generic", or "auto".'),
        turns: z.number().optional().describe("Agent turns to project the loop cost over. Default 8."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: target, format, turns }) => {
      const root = target ?? process.cwd();
      const { project } = await loadProject(root, format);
      const fp = await measure(project, { turns: turns ?? 8 });

      const lines: string[] = [];
      for (const c of fp.changes) {
        const loop = c.tokens * fp.turns;
        lines.push(
          `${c.id}: ${formatTokens(c.tokens)} tokens; over ${fp.turns} turns ~${formatTokens(loop)} (~${formatCost(inputCost(loop, fp.model))} at ${fp.model} input rates)`,
        );
        for (const d of c.documents) {
          lines.push(`    ${formatTokens(d.tokens).padStart(6)}  ${path.relative(root, d.path).replace(/\\/g, "/")}`);
        }
      }
      lines.push("", `Total ${formatTokens(fp.totalTokens)} tokens. Estimated locally, +/-15%.`);
      const body = lines.join("\n");
      usage.record("spec_footprint", body);
      return text(body);
    },
  );

  server.registerTool(
    "specsy_usage",
    {
      title: "What specsy has cost this conversation",
      description:
        "Report how many times specsy has been called this session and roughly how many tokens its " +
        "output has added to the conversation. This covers specsy's own contribution only — it cannot " +
        "see the agent's total token usage, which belongs to the host application.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(usage.summary()),
  );

  return server;
}

/** Worked examples, used by explain_rule. The teaching surface for beginners. */
const EXAMPLES: Record<string, { why: string; bad: string; good: string }> = {
  "no-weasel-words": {
    why: "A word you cannot write a test for is a decision the agent will make for you, silently.",
    bad: "The export MUST be fast and handle errors gracefully.",
    good: "The export MUST complete within 2 seconds for 10000 rows, and MUST return HTTP 413 above that.",
  },
  "quantify-performance": {
    why: "Performance without a number is a wish. The agent has to pick a target, and it will pick one you never saw.",
    bad: "Search MUST be responsive.",
    good: "Search MUST return results at p95 under 200ms for a 1M-row index.",
  },
  "use-normative-keywords": {
    why: "\"Will\" and \"should probably\" leave it unclear whether something is required or merely nice.",
    bad: "The system will retry failed uploads.",
    good: "The system MUST retry a failed upload up to 3 times with exponential backoff.",
  },
  "one-requirement-per-statement": {
    why: "Two obligations in one sentence cannot be tested, traced, or partially satisfied independently.",
    bad: "The system MUST validate the currency and MUST reject amounts of zero.",
    good: "The system MUST validate the currency.\nThe system MUST reject an amount of zero.",
  },
  "require-acceptance-criteria": {
    why: "Without a scenario, nothing decides whether the implementation satisfied the requirement.",
    bad: "### Requirement: Account creation\nThe system MUST create accounts.",
    good: "### Requirement: Account creation\nThe system MUST create an account from a name and a currency.\n\n#### Scenario: Valid input\n- WHEN a client posts a name and \"EUR\"\n- THEN the account is created",
  },
  "require-non-goals": {
    why: "An unbounded scope is the most common reason an agent builds the wrong thing.",
    bad: "## What Changes\nAdd CSV export.",
    good: "## What Changes\nAdd CSV export.\n\n## Non-Goals\n- Scheduled or emailed exports\n- Formats other than CSV",
  },
  "no-placeholders": {
    why: "An agent will implement around a TBD and invent the missing decision rather than stop and ask.",
    bad: "Session length: TODO decide this.",
    good: "A session MUST expire 30 minutes after the last request.",
  },
  "no-implementation-in-requirements": {
    why: "Naming a library in a requirement means the spec has to change when the stack does.",
    bad: "The system MUST cache sessions in Redis.",
    good: "The system MUST serve a repeat session lookup without hitting the database. (Redis chosen in design.md.)",
  },
  "no-dangling-references": {
    why: "A task citing an id that does not exist means either a typo or a requirement nobody wrote.",
    bad: "- [ ] 1.1 Add the login form (AUTH-9)   <- no AUTH-9 exists",
    good: "- [ ] 1.1 Add the login form (AUTH-1)",
  },
};

export async function runStdioServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
