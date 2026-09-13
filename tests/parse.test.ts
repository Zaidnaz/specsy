import { describe, expect, it } from "vitest";
import { parseListItems, parseSections, readLines, stripNoise } from "../src/markdown.js";
import { extractRequirements, extractTasks } from "../src/adapters/extract.js";

const F = "test.md";

describe("readLines", () => {
  it("marks fenced blocks so rules never lint code samples", () => {
    const lines = readLines(["prose", "```ts", "const fast = 1;", "```", "more"].join("\n"));
    expect(lines.map((l) => l.inCode)).toEqual([false, true, true, true, false]);
  });

  it("does not let a tilde fence close a backtick fence", () => {
    const lines = readLines(["```", "~~~", "still code", "```", "out"].join("\n"));
    expect(lines.at(-1)?.inCode).toBe(false);
    expect(lines[2]?.inCode).toBe(true);
  });
});

describe("parseSections", () => {
  it("records where the body starts, despite trimming blank lines", () => {
    const raw = ["# Title", "", "", "first body line", "", "## Next"].join("\n");
    const [title] = parseSections(raw, F);
    expect(title?.bodyStartLine).toBe(4);
    expect(title?.body).toBe("first body line");
  });

  it("treats a parent heading with only subsections as having no body of its own", () => {
    const [parent] = parseSections("# A\n## B\ncontent", F);
    expect(parent?.body).toBe("");
  });
});

describe("parseListItems", () => {
  it("separates checkboxes from plain bullets", () => {
    const items = parseListItems("- [ ] todo\n- [x] done\n- plain", F);
    expect(items.map((i) => i.checked)).toEqual([false, true, undefined]);
  });
});

describe("stripNoise", () => {
  it("removes inline code so identifiers do not trip word rules", () => {
    expect(stripNoise("the `fast_path` flag").includes("fast")).toBe(false);
  });
});

describe("extractTasks", () => {
  // Regression: an id-shaped token mid-line is a reference to a requirement,
  // not the task's own id. Conflating them silently erased every link.
  it("reads a numeric prefix as the task id and REQ tokens as references", () => {
    const [task] = extractTasks("- [ ] 1.1 Add the endpoint (EXP-1)", F);
    expect(task?.id).toBe("1.1");
    expect(task?.refs).toEqual(["EXP-1"]);
  });

  it("treats a leading id token as the task's own id", () => {
    const [task] = extractTasks("- [ ] TASK-3: do it (EXP-2)", F);
    expect(task?.id).toBe("TASK-3");
    expect(task?.refs).toEqual(["EXP-2"]);
  });

  it("collects multiple references", () => {
    const [task] = extractTasks("- [ ] 2.1 Wire both (EXP-1, EXP-2)", F);
    expect(task?.refs).toEqual(["EXP-1", "EXP-2"]);
  });

  it("ignores plain bullets", () => {
    expect(extractTasks("- not a task", F)).toHaveLength(0);
  });
});

describe("extractRequirements", () => {
  it("reads Requirement headings with their Scenario children", () => {
    const raw = [
      "### Requirement: EXP-1 Export",
      "The list MUST export.",
      "",
      "#### Scenario: happy path",
      "- **WHEN** x",
      "- **THEN** y",
    ].join("\n");
    const [req] = extractRequirements(raw, F, "spec");
    expect(req?.id).toBe("EXP-1");
    expect(req?.criteria).toHaveLength(1);
  });

  it("falls back to normative prose when the document has no Requirement headings", () => {
    const reqs = extractRequirements("## Rules\nThe API MUST return 404.\nSome background prose.", F, "spec");
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.text).toContain("MUST return 404");
  });
});
