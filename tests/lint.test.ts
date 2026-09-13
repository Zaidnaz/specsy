import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openspecAdapter } from "../src/adapters/openspec.js";
import { detectAdapter, getAdapter } from "../src/adapters/index.js";
import { lint } from "../src/engine/lint.js";
import { allRules } from "../src/rules/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, "fixtures", name);

async function run(name: string, config = {}) {
  const project = await openspecAdapter.load(fixture(name));
  return lint(project, config);
}

/** Rule ids that fired, deduplicated. */
const fired = (r: Awaited<ReturnType<typeof run>>) => [...new Set(r.diagnostics.map((d) => d.rule))].sort();

describe("adapters", () => {
  it("detects an OpenSpec layout", async () => {
    expect((await detectAdapter(fixture("clean")))?.name).toBe("openspec");
  });

  it("exposes every adapter by name", () => {
    expect(getAdapter("openspec")).toBeDefined();
    expect(getAdapter("generic")).toBeDefined();
    expect(getAdapter("nope")).toBeUndefined();
  });
});

describe("a well-formed change", () => {
  it("produces no diagnostics at all", async () => {
    const result = await run("clean");
    // Printed so a future false positive names itself in the failure output.
    expect(result.diagnostics.map((d) => `${d.rule}: ${d.message}`)).toEqual([]);
  });

  it("still parses the requirements it found", async () => {
    const result = await run("clean");
    expect(result.documentCount).toBe(3);
  });
});

describe("a messy change", () => {
  it("flags exactly the problems it contains", async () => {
    expect(fired(await run("messy"))).toEqual([
      "no-dangling-references",
      "no-placeholders",
      "one-requirement-per-statement",
      "no-weasel-words",
      "quantify-performance",
      "require-acceptance-criteria",
      "require-non-goals",
      "require-requirement-ids",
      "tasks-reference-requirements",
      "use-normative-keywords",
    ].sort());
  });

  it("points at the undefined requirement by name", async () => {
    const d = (await run("messy")).diagnostics.find((x) => x.rule === "no-dangling-references");
    expect(d?.message).toContain("AUTH-9");
    expect(d?.severity).toBe("error");
  });

  it("separates errors from warnings", async () => {
    const result = await run("messy");
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.warnCount).toBeGreaterThan(0);
  });
});

describe("configuration", () => {
  it("silences a rule set to off", async () => {
    const result = await run("messy", { rules: { "no-weasel-words": "off" } });
    expect(fired(result)).not.toContain("no-weasel-words");
  });

  it("honours a severity override", async () => {
    const result = await run("messy", { rules: { "no-weasel-words": "error" } });
    const d = result.diagnostics.find((x) => x.rule === "no-weasel-words");
    expect(d?.severity).toBe("error");
  });

  it("applies extra weasel words from config", async () => {
    const result = await run("messy", { weaselWords: ["repeated"] });
    expect(result.diagnostics.some((d) => d.message.includes("repeated"))).toBe(true);
  });
});

describe("the rule set", () => {
  it("has unique ids", () => {
    const ids = allRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every rule a description and a default severity", () => {
    for (const rule of allRules) {
      expect(rule.description.length, rule.id).toBeGreaterThan(10);
      expect(["error", "warn"], rule.id).toContain(rule.defaultSeverity);
    }
  });

  it("emits a hint with every diagnostic, so a finding is always actionable", async () => {
    for (const d of (await run("messy")).diagnostics) {
      expect(d.hint, d.rule).toBeTruthy();
    }
  });

  it("reports positions that exist in the file", async () => {
    const result = await run("messy");
    for (const d of result.diagnostics) {
      expect(d.span.line, `${d.rule} in ${d.span.file}`).toBeGreaterThan(0);
    }
  });
});
