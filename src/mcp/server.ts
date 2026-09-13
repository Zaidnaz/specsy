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
import { EXAMPLES } from "../explain.js";
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
  const server = new McpServer({ name: "specsy", version: "0.2.3" });

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
      const { adapter, project } = await loadProject(root, format);

      if (change && !adapter.hasChanges) {
        const body =
          `The ${adapter.label} format has no in-flight changes, so "change" cannot narrow this run. ` +
          `Drop the change argument, or point at an OpenSpec project.`;
        usage.record("lint_specs", body);
        return text(body);
      }

      // Only real changes are selectable: the living spec is a pseudo-change
      // whose id is a display label, and matching on it was an accident.
      const selected = change
        ? { ...project, changes: project.changes.filter((c) => c.kind === "change" && c.id === change) }
        : project;
      if (change && selected.changes.length === 0) {
        const known = project.changes.filter((c) => c.kind === "change").map((c) => c.id).join(", ");
        const body = `No change named "${change}". Available: ${known || "(none)"}.`;
        usage.record("lint_specs", body);
        return text(body);
      }

      const { config: fileConfig } = await loadConfig(root);
      const config = resolveConfig(fileConfig);

      const result = lint(selected, config);
      if (result.documentCount === 0) {
        const body =
          "Nothing was examined: every document was excluded, so this run checked nothing. " +
          "Check the \"ignore\" setting in .specsyrc.json.";
        usage.record("lint_specs", body);
        return text(body);
      }

      // errors_only hides warnings from the reply but never from the counts:
      // an agent told "no problems" when warnings exist has been misled.
      const shown = errors_only
        ? result.diagnostics.filter((d) => d.severity === "error")
        : result.diagnostics;
      const lines: string[] = [];

      if (result.diagnostics.length === 0) {
        lines.push(`No problems in ${result.documentCount} document(s). The specs are ready to implement.`);
      } else {
        for (const d of shown) {
          const rel = path.relative(root, d.span.file).replace(/\\/g, "/");
          lines.push(`${rel}:${d.span.line}:${d.span.column ?? 1} ${d.severity} [${d.rule}] ${d.message}`);
          if (d.hint) lines.push(`    fix: ${d.hint}`);
        }
        lines.push("");
        lines.push(
          `${result.errorCount} error(s), ${result.warnCount} warning(s) in ${result.documentCount} document(s).` +
            (errors_only && result.warnCount > 0 ? " Warnings were found but not listed (errors_only)." : ""),
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

export async function runStdioServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
