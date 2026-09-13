/**
 * Worked examples for each rule: what fails, what passes, and why it matters.
 *
 * Shared by `specsy explain` and the MCP `explain_rule` tool so a person and
 * an agent are taught exactly the same thing.
 */
import { allRules, getRule } from "./rules/index.js";

export interface RuleExample {
  why: string;
  bad: string;
  good: string;
}

export const EXAMPLES: Record<string, RuleExample> = {
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
    why: '"Will" and "should probably" leave it unclear whether something is required or merely nice.',
    bad: "The system will retry failed uploads.",
    good: "The system MUST retry a failed upload up to 3 times with exponential backoff.",
  },
  "one-requirement-per-statement": {
    why: "Two obligations in one sentence cannot be tested, traced, or partially satisfied independently.",
    bad: "The system MUST validate the currency and MUST reject amounts of zero.",
    good: "The system MUST validate the currency.\n        The system MUST reject an amount of zero.",
  },
  "no-ambiguous-pronoun": {
    why: "A reader arriving from a task link has no preceding sentence to resolve the pronoun against.",
    bad: "### Requirement: Session expiry\n        It expires after a while.",
    good: "### Requirement: Session expiry\n        A session MUST expire 30 minutes after the last request.",
  },
  "require-acceptance-criteria": {
    why: "Without a scenario, nothing decides whether the implementation satisfied the requirement.",
    bad: "### Requirement: Account creation\n        The system MUST create accounts.",
    good:
      "### Requirement: Account creation\n" +
      "        The system MUST create an account from a name and a currency.\n\n" +
      "        #### Scenario: Valid input\n" +
      '        - WHEN a client posts a name and "EUR"\n' +
      "        - THEN the account is created",
  },
  "no-placeholders": {
    why: "An agent will implement around a TBD and invent the missing decision rather than stop and ask.",
    bad: "Session length: TODO decide this.",
    good: "A session MUST expire 30 minutes after the last request.",
  },
  "no-empty-sections": {
    why: "An empty heading reads as an answered question. Either it has content or it should not be there.",
    bad: "## Non-Goals\n\n        ## Risks",
    good: "## Non-Goals\n\n        - Scheduled exports\n        - Formats other than CSV",
  },
  "require-sections": {
    why: "Reviewers and agents both look for why-and-what first; a proposal missing them is hard to evaluate.",
    bad: "# Add export\n\n        Some notes.",
    good: "# Add export\n\n        ## Why\n        ...\n\n        ## What Changes\n        ...",
  },
  "no-implementation-in-requirements": {
    why: "Naming a library in a requirement means the spec has to change when the stack does.",
    bad: "The system MUST cache sessions in Redis.",
    good: "The system MUST serve a repeat session lookup without querying the database.\n        (Redis chosen in design.md.)",
  },
  "unique-requirement-ids": {
    why: "A task citing REQ-001 cannot tell two files apart, so duplicates silently merge two requirements.",
    bad: "specs/a/spec.md: ### Requirement: REQ-001 Login\n        specs/b/spec.md: ### Requirement: REQ-001 Logout",
    good: "specs/a/spec.md: ### Requirement: AUTH-001 Login\n        specs/b/spec.md: ### Requirement: AUTH-002 Logout",
  },
  "tasks-reference-requirements": {
    why: "An unlinked task is how scope creep enters: work with no requirement behind it.",
    bad: "- [ ] 1.1 Add the login form",
    good: "- [ ] 1.1 Add the login form (AUTH-001)",
  },
  "no-dangling-references": {
    why: "A task citing an id that does not exist means either a typo or a requirement nobody wrote.",
    bad: "- [ ] 1.1 Add the login form (AUTH-9)      <- no AUTH-9 exists",
    good: "- [ ] 1.1 Add the login form (AUTH-001)",
  },
  "requirements-have-tasks": {
    why: "A requirement no task implements ships as silently missing behaviour.",
    bad: "AUTH-003 exists in the spec; no task mentions it.",
    good: "- [ ] 2.1 Lock the account after 5 failures (AUTH-003)",
  },
  "require-non-goals": {
    why: "An unbounded scope is the most common reason an agent builds the wrong thing.",
    bad: "## What Changes\n        Add CSV export.",
    good:
      "## What Changes\n        Add CSV export.\n\n" +
      "        ## Non-Goals\n" +
      "        - Scheduled or emailed exports\n" +
      "        - Formats other than CSV",
  },
  "require-requirement-ids": {
    why: "Without an id, nothing downstream — a task, a test, a commit — can point back at this requirement.",
    bad: "### Requirement: Account creation",
    good: "### Requirement: ACCT-001 Account creation",
  },
};

/** Plain-text explanation of one rule. Returns undefined for an unknown id. */
export function explainRule(id: string): string | undefined {
  const rule = getRule(id);
  if (!rule) return undefined;
  const ex = EXAMPLES[rule.id];
  const lines = [
    `${rule.id}  (${rule.defaultSeverity} by default)`,
    "",
    rule.description,
    `Applies to: ${(rule.appliesTo ?? ["every document kind"]).join(", ")}.`,
  ];
  if (ex) {
    lines.push("", `Why:    ${ex.why}`, "", `Fails:  ${ex.bad}`, "", `Passes: ${ex.good}`);
  }
  lines.push("", `Turn it off with {"rules": {"${rule.id}": "off"}} in .specsyrc.json.`);
  return lines.join("\n");
}

/** Rule ids closest to a mistyped one, for a did-you-mean. */
export function nearestRules(input: string, limit = 3): string[] {
  return allRules
    .map((r) => ({ id: r.id, d: distance(input, r.id) }))
    .filter((e) => e.d <= Math.max(3, Math.floor(e.id.length / 2)))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((e) => e.id);
}

/** Levenshtein distance, used only for suggestions. */
export function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[n]!;
}
