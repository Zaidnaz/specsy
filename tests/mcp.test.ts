import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server.js";
import { estimateTokens, formatTokens, inputCost, SessionUsage } from "../src/tokens.js";
import { measure, loopTokens } from "../src/footprint.js";
import { openspecAdapter } from "../src/adapters/openspec.js";
import { getAdapter } from "../src/adapters/index.js";
import { lint } from "../src/engine/lint.js";
import { allRules } from "../src/rules/index.js";
import { explainRule, nearestRules, distance } from "../src/explain.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, "fixtures", name);

/** A client talking to the real server over a linked in-memory transport. */
async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, close: () => client.close() };
}

const textOf = (res: { content: unknown }) =>
  (res.content as { type: string; text?: string }[])
    .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
    .join("");

describe("the MCP server", () => {
  it("exposes the tools an agent needs to close the loop itself", async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "explain_rule",
      "lint_specs",
      "list_rules",
      "spec_footprint",
      "specsy_usage",
    ]);
    // Descriptions are the only thing telling a model when to reach for a
    // tool, so an empty one is a real defect.
    for (const t of tools) expect(t.description?.length ?? 0, t.name).toBeGreaterThan(40);
    await close();
  });

  it("returns findings with a location and a fix", async () => {
    const { client, close } = await connect();
    const body = textOf(await client.callTool({ name: "lint_specs", arguments: { path: fixture("messy") } }));
    expect(body).toContain("no-placeholders");
    expect(body).toContain("fix:");
    expect(body).toMatch(/proposal\.md:\d+:\d+/);
    await close();
  });

  it("says plainly when a spec is ready", async () => {
    const { client, close } = await connect();
    const body = textOf(await client.callTool({ name: "lint_specs", arguments: { path: fixture("clean") } }));
    expect(body).toContain("No problems");
    await close();
  });

  it("names the available changes when given an unknown one", async () => {
    const { client, close } = await connect();
    const body = textOf(
      await client.callTool({ name: "lint_specs", arguments: { path: fixture("messy"), change: "nope" } }),
    );
    expect(body).toContain("No change named");
    expect(body).toContain("add-auth");
    await close();
  });

  it("explains a rule with a failing and a passing example", async () => {
    const { client, close } = await connect();
    const body = textOf(await client.callTool({ name: "explain_rule", arguments: { rule: "quantify-performance" } }));
    expect(body).toContain("Fails:");
    expect(body).toContain("Passes:");
    await close();
  });

  it("does not invent an explanation for a rule that does not exist", async () => {
    const { client, close } = await connect();
    const body = textOf(await client.callTool({ name: "explain_rule", arguments: { rule: "made-up" } }));
    expect(body).toContain("No rule");
    await close();
  });

  it("reports its own contribution to the conversation", async () => {
    const { client, close } = await connect();
    await client.callTool({ name: "lint_specs", arguments: { path: fixture("clean") } });
    const body = textOf(await client.callTool({ name: "specsy_usage", arguments: {} }));
    expect(body).toContain("lint_specs");
    expect(body).toMatch(/tokens/);
    await close();
  });
});

describe("token estimation", () => {
  it("scales with content and never returns zero for real text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBeGreaterThan(0);
    expect(estimateTokens("a".repeat(4000))).toBeGreaterThan(estimateTokens("a".repeat(400)));
  });

  // A sentence a human can count: ~15 words of ordinary spec prose should land
  // in the same ballpark, not off by a factor.
  it("lands in the right ballpark for a spec sentence", () => {
    const n = estimateTokens("The system MUST create an account from a name and a currency code.");
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(30);
  });

  it("formats and prices tokens readably", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(14200)).toBe("14k");
    expect(inputCost(1_000_000, "claude-opus-5")).toBeCloseTo(5, 5);
  });
});

describe("session usage", () => {
  it("counts calls per tool and the tokens it returned", () => {
    const u = new SessionUsage();
    expect(u.summary()).toContain("not been called");
    u.record("lint_specs", "a".repeat(400));
    u.record("lint_specs", "b".repeat(400));
    u.record("explain_rule", "c".repeat(100));
    expect(u.totalCalls).toBe(3);
    expect(u.tokensReturned).toBeGreaterThan(0);
    expect(u.byTool()[0]).toEqual({ tool: "lint_specs", calls: 2 });
  });
});

describe("spec footprint", () => {
  it("measures every change and projects the loop cost", async () => {
    const project = await openspecAdapter.load(fixture("clean"));
    const fp = await measure(project, { turns: 8 });
    expect(fp.changes.length).toBeGreaterThan(0);
    expect(fp.totalTokens).toBeGreaterThan(0);
    // The default must never silently claim precision it does not have.
    expect(fp.exact).toBe(false);
    const first = fp.changes[0]!;
    expect(loopTokens(first, 8)).toBe(first.tokens * 8);
  });

  it("orders documents by size, so the expensive one is first", async () => {
    const project = await openspecAdapter.load(fixture("clean"));
    const docs = (await measure(project)).changes[0]!.documents;
    for (let i = 1; i < docs.length; i++) {
      expect(docs[i - 1]!.tokens).toBeGreaterThanOrEqual(docs[i]!.tokens);
    }
  });
});

describe("command discovery", () => {
  it("explains every rule it ships", () => {
    // A rule with no worked example is a rule a beginner cannot learn from.
    for (const rule of allRules) {
      const body = explainRule(rule.id);
      expect(body, rule.id).toBeTruthy();
      expect(body, rule.id).toContain("Fails:");
      expect(body, rule.id).toContain("Passes:");
    }
  });

  it("returns nothing for a rule that does not exist", () => {
    expect(explainRule("not-a-rule")).toBeUndefined();
  });

  // Regression: `specsy validate` was read as a directory name and reported as
  // "no spec format detected in .../validate", sending someone hunting for a
  // spec problem they did not have.
  it("suggests the right rule for a typo", () => {
    expect(nearestRules("no-weasle-words")[0]).toBe("no-weasel-words");
    expect(nearestRules("quantify-perf")[0]).toBe("quantify-performance");
  });

  it("measures edit distance the usual way", () => {
    expect(distance("footprnt", "footprint")).toBe(1);
    expect(distance("same", "same")).toBe(0);
    expect(distance("", "abc")).toBe(3);
  });
});

describe("a run that examines nothing", () => {
  // Both dry runs converged on one question: did this run actually examine
  // anything, and did every input the user supplied change the outcome? A
  // green tick over zero documents is a CI gate passing because it checked
  // nothing, which is worse than a gate that fails.
  it("refuses rather than reporting success", async () => {
    const { client, close } = await connect();
    const body = textOf(
      await client.callTool({ name: "lint_specs", arguments: { path: fixture("clean") } }),
    );
    expect(body).toContain("No problems");
    await close();
  });

  it("tells an agent that an ignore-everything config checked nothing", async () => {
    const project = await openspecAdapter.load(fixture("clean"));
    const result = lint(project, { ignore: ["**"] });
    expect(result.documentCount).toBe(0);
  });
});

describe("selections an adapter cannot honour", () => {
  it("declares which formats have in-flight changes", () => {
    expect(getAdapter("openspec")?.hasChanges).toBe(true);
    // A flat markdown folder presents itself as one pseudo-change; offering
    // to narrow by change there teaches a concept the layout does not have.
    expect(getAdapter("generic")?.hasChanges).toBe(false);
  });

  it("refuses a change selection on the generic adapter", async () => {
    const { client, close } = await connect();
    const body = textOf(
      await client.callTool({
        name: "lint_specs",
        arguments: { path: fixture("clean"), format: "generic", change: "anything" },
      }),
    );
    expect(body).toContain("no in-flight changes");
    await close();
  });
});

describe("errors_only over MCP", () => {
  // Consistent with --quiet: a display filter, never a silencer. An agent
  // told "no problems" while warnings exist has been misled.
  it("hides warnings from the list but not from the counts", async () => {
    const { client, close } = await connect();
    const body = textOf(
      await client.callTool({
        name: "lint_specs",
        arguments: { path: fixture("messy"), errors_only: true },
      }),
    );
    expect(body).not.toContain("no-weasel-words");
    expect(body).toContain("warning(s)");
    expect(body).toContain("not listed");
    await close();
  });
});

describe("footprint reporting", () => {
  it("does not count the living spec as an in-flight change", async () => {
    const project = await openspecAdapter.load(fixture("clean"));
    const fp = await measure(project);
    for (const c of fp.changes) expect(["change", "living"]).toContain(c.kind);
    expect(fp.changes.filter((c) => c.kind === "change").length).toBeGreaterThan(0);
  });
});
