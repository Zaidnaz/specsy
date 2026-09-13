import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./types.js";

const FILENAMES = [".specsyrc.json", "specsy.config.json"];

/** Load config from the nearest known filename, walking up to the repo root. */
export async function loadConfig(cwd: string): Promise<{ config: Config; path?: string }> {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of FILENAMES) {
      const file = path.join(dir, name);
      try {
        const raw = await readFile(file, "utf8");
        return { config: JSON.parse(raw) as Config, path: file };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw new Error(`Failed to read ${file}: ${(err as Error).message}`);
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return { config: {} };
    dir = parent;
  }
}

/**
 * Check a config file before anything acts on it.
 *
 * A misspelled rule id used to be accepted in silence: the user wrote
 * `"no-weasle-words": "off"`, the rule fired anyway, and nothing said why.
 * That is the same silent-wrong-answer failure specsy exists to catch in
 * specs, happening in specsy's own config, so it is an error rather than a
 * warning -- a config file is a deliberate statement of intent.
 */
export function validateConfig(config: Config, known: { id: string }[]): string[] {
  const errors: string[] = [];
  const TOP_LEVEL = new Set(["format", "rules", "weaselWords", "ignore"]);
  const SEVERITIES = new Set(["error", "warn", "off"]);
  const ids = new Set(known.map((r) => r.id));

  for (const key of Object.keys(config)) {
    if (TOP_LEVEL.has(key)) continue;
    errors.push(
      `Unknown setting "${key}". Known settings: ${[...TOP_LEVEL].sort().join(", ")}.`,
    );
  }

  for (const [id, severity] of Object.entries(config.rules ?? {})) {
    if (!ids.has(id)) {
      const near = [...ids]
        .map((k) => ({ k, d: editDistance(id, k) }))
        .filter((e) => e.d <= 3)
        .sort((a, b) => a.d - b.d)[0];
      errors.push(
        `Unknown rule "${id}".` + (near ? ` Did you mean "${near.k}"?` : " Run 'specsy rules' to list them."),
      );
      continue;
    }
    if (!SEVERITIES.has(severity)) {
      errors.push(`Rule "${id}" has severity "${severity}". Use "error", "warn" or "off".`);
    }
  }

  for (const field of ["weaselWords", "ignore"] as const) {
    const value = config[field];
    if (value !== undefined && !Array.isArray(value)) {
      errors.push(`"${field}" must be an array of strings.`);
    }
  }

  return errors;
}

/** Levenshtein distance, for did-you-mean only. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i, ...Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length]!;
}
