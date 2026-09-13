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
