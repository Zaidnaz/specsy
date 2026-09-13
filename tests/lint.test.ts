import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openspecAdapter } from "../src/adapters/openspec.js";
import { adapters, detectAdapter, getAdapter } from "../src/adapters/index.js";
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

describe("a proposal written as plain prose", () => {
  // Regression: clarity rules used to run only over extracted requirements,
  // and a proposal only yields those when it contains MUST/SHALL. Proposals
  // written in ordinary English were therefore exempt from the rules that
  // matter most, and reported clean.
  it("is linted even with no normative keyword anywhere", async () => {
    const result = await run("prose");
    expect(fired(result)).toContain("no-weasel-words");
    expect(fired(result)).toContain("quantify-performance");
  });

  it("flags the vague words in the What Changes section", async () => {
    const messages = (await run("prose")).diagnostics.map((d) => d.message).join(" | ");
    expect(messages).toContain("user-friendly");
    expect(messages).toContain("gracefully");
    expect(messages).toContain("fast");
  });

  // "Search feels slow" is a problem statement, not an unmeasurable
  // requirement. Motivation sections are deliberately exempt.
  it("leaves the Why section alone", async () => {
    const onWhy = (await run("prose")).diagnostics.filter((d) => d.span.line >= 5 && d.span.line <= 6);
    expect(onWhy.map((d) => `${d.rule}: ${d.message}`)).toEqual([]);
  });

  it("flags an open-ended list that really trails off", async () => {
    const messages = (await run("prose")).diagnostics.map((d) => d.message).join(" | ");
    expect(messages).toContain("etc");
  });

  // Regression: "and more" matched inside "fast and more user-friendly",
  // where it is not a list ending at all.
  it("does not flag \"and more\" mid-sentence", async () => {
    const messages = (await run("prose")).diagnostics.map((d) => d.message);
    expect(messages.filter((m) => m.includes("and more"))).toEqual([]);
  });
});

describe("adapter auto-detection", () => {
  // Regression: the generic adapter matched any directory containing markdown,
  // so `npx specsy` in a home directory linted thousands of unrelated files.
  it("never selects the generic adapter on its own", async () => {
    for (const a of adapters) {
      if (a.name === "generic") expect(a.autoDetect).toBe(false);
    }
    expect((await detectAdapter(fixture("prose")))?.name).toBe("openspec");
  });

  it("still allows the generic adapter when asked for explicitly", () => {
    expect(getAdapter("generic")?.autoDetect).toBe(false);
    expect(getAdapter("generic")).toBeDefined();
  });
});

describe("a conforming OpenSpec change that uses no ids", () => {
  // The canary for the worst class of defect this linter can have: complaining
  // that a correct spec is wrong. A real OpenSpec project produced 45 findings,
  // 40 of them false, before these guards existed.
  it("produces no findings at all", async () => {
    const result = await run("openspec-conventional");
    expect(result.diagnostics.map((d) => `${d.rule}: ${d.message}`)).toEqual([]);
  });

  // Regression: `[A-Z][A-Z0-9]{1,4}-\d+` matched ISO-4217 and ISO-8601 in
  // prose, inventing requirement ids and reporting a duplicate-id error.
  it("does not mistake a standards reference for a requirement id", async () => {
    const project = await openspecAdapter.load(fixture("openspec-conventional"));
    const ids = project.changes
      .flatMap((c) => c.documents)
      .flatMap((d) => d.requirements)
      .map((r) => r.id);
    expect(ids).toEqual([undefined, undefined]);
  });

  it("stays silent about ids when the format does not use them", async () => {
    expect(fired(await run("openspec-conventional"))).not.toContain("require-requirement-ids");
  });

  it("stays silent about task citations when no task cites anything", async () => {
    const rules = fired(await run("openspec-conventional"));
    expect(rules).not.toContain("tasks-reference-requirements");
    expect(rules).not.toContain("requirements-have-tasks");
  });
});

describe("requirement id extraction", () => {
  it("takes an id only when it opens the heading", async () => {
    const project = await openspecAdapter.load(fixture("clean"));
    const ids = project.changes
      .flatMap((c) => c.documents)
      .flatMap((d) => d.requirements)
      .flatMap((r) => (r.id ? [r.id] : []));
    expect(ids).toEqual(["EXP-1", "EXP-2"]);
  });

  // Once a project adopts ids, the rules that depend on them switch back on.
  it("still flags an inconsistent spec once ids are in use", async () => {
    expect(fired(await run("messy"))).toContain("require-requirement-ids");
  });
});

describe("ids and obligations across files and line wraps", () => {
  // Both found by an agent working in a real OpenSpec repo, which had adopted
  // ACCT-/TXN-/BAL- prefixes specifically to route around the first one.
  it("catches a duplicate id shared by two files in one change", async () => {
    const d = (await run("id-edges")).diagnostics.find((x) => x.rule === "unique-requirement-ids");
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain("DUP-001");
    // Naming the file matters: every file in an OpenSpec change is spec.md.
    expect(d?.message).toContain("specs/a/spec.md");
  });

  // Regression: sentences were split per physical line, so a compound
  // requirement escaped simply by being wrapped.
  it("catches a compound sentence broken across a line wrap", async () => {
    const hits = (await run("id-edges")).diagnostics.filter(
      (d) => d.rule === "one-requirement-per-statement",
    );
    expect(hits).toHaveLength(1);
  });

  it("leaves correctly split obligations alone", async () => {
    const hits = (await run("id-edges")).diagnostics.filter(
      (d) => d.rule === "one-requirement-per-statement" && d.span.line > 18,
    );
    expect(hits).toEqual([]);
  });
});
