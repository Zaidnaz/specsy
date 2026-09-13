/**
 * The context footprint of a set of specs.
 *
 * The number that matters is not "this change is 14k tokens" but "this change
 * is 14k tokens, re-read on every turn". Agents in a spec-driven loop pay the
 * spec's size repeatedly, so a bloated proposal is a recurring bill, not a
 * one-off.
 */
import type { SpecChange, SpecDocument, SpecProject } from "./model.js";
import { DEFAULT_MODEL, countTokens, formatCost, formatTokens, inputCost } from "./tokens.js";

export interface DocumentFootprint {
  path: string;
  kind: SpecDocument["kind"];
  bytes: number;
  tokens: number;
}

export interface ChangeFootprint {
  id: string;
  tokens: number;
  documents: DocumentFootprint[];
}

export interface Footprint {
  changes: ChangeFootprint[];
  totalTokens: number;
  exact: boolean;
  model: string;
  /** Turns assumed when projecting the cost of one implementation loop. */
  turns: number;
}

export interface FootprintOptions {
  exact?: boolean;
  model?: string;
  /**
   * How many agent turns a change is assumed to survive. Eight is a plausible
   * mid-size implementation; it is a stated assumption, not a measurement,
   * and the flag exists so nobody has to accept it.
   */
  turns?: number;
}

async function documentFootprint(
  doc: SpecDocument,
  opts: FootprintOptions,
): Promise<DocumentFootprint> {
  const count = await countTokens(doc.raw, { exact: opts.exact ?? false, model: opts.model });
  return {
    path: doc.path,
    kind: doc.kind,
    bytes: Buffer.byteLength(doc.raw, "utf8"),
    tokens: count.tokens,
  };
}

export async function measure(
  project: SpecProject,
  opts: FootprintOptions = {},
): Promise<Footprint> {
  const model = opts.model ?? DEFAULT_MODEL;
  const turns = opts.turns ?? 8;
  const changes: ChangeFootprint[] = [];
  let exact = opts.exact ?? false;

  for (const change of project.changes) {
    const documents = await Promise.all(change.documents.map((d) => documentFootprint(d, opts)));
    changes.push({
      id: change.id,
      tokens: documents.reduce((sum, d) => sum + d.tokens, 0),
      documents: documents.sort((a, b) => b.tokens - a.tokens),
    });
  }

  // If an exact count was requested but the API was unreachable, countTokens
  // silently fell back; say estimate rather than claim a precision we lack.
  if (exact && changes.every((c) => c.tokens === 0)) exact = false;

  return {
    changes: changes.sort((a, b) => b.tokens - a.tokens),
    totalTokens: changes.reduce((sum, c) => sum + c.tokens, 0),
    exact,
    model,
    turns,
  };
}

/** Tokens a change costs across a whole implementation loop. */
export function loopTokens(change: ChangeFootprint, turns: number): number {
  return change.tokens * turns;
}

export function formatFootprint(fp: Footprint, cwd: string, changeOf: (c: SpecChange) => string = () => ""): string {
  void changeOf;
  const out: string[] = [];
  const label = fp.exact ? "exact" : "estimated";

  for (const change of fp.changes) {
    out.push(`${change.id}  ${formatTokens(change.tokens)} tokens`);
    for (const doc of change.documents) {
      const rel = doc.path.startsWith(cwd) ? doc.path.slice(cwd.length + 1) : doc.path;
      out.push(
        `  ${formatTokens(doc.tokens).padStart(6)}  ${doc.kind.padEnd(13)} ${rel.replace(/\\/g, "/")}`,
      );
    }
    const loop = loopTokens(change, fp.turns);
    out.push(
      `  ${"".padStart(6)}  re-read over ${fp.turns} agent turns: ~${formatTokens(loop)} tokens, ~${formatCost(inputCost(loop, fp.model))}`,
    );
    out.push("");
  }

  out.push(
    `Total ${formatTokens(fp.totalTokens)} tokens across ${fp.changes.length} change(s) — ${label}, ${fp.model} input rates.`,
  );
  if (!fp.exact) {
    out.push(`Estimate is ±15%. Use --exact with an Anthropic API key for real counts.`);
  }
  return out.join("\n");
}
