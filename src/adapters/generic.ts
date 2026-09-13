import path from "node:path";
import fg from "fast-glob";
import type { Adapter } from "./types.js";
import type { SpecProject } from "../model.js";
import { loadDocument } from "./extract.js";

/**
 * Last-resort adapter: treat a directory of markdown as one change.
 *
 * It exists so someone can point spec-lint at any spec folder and get value
 * on the first run, without adopting a format first. Traceability rules are
 * weaker here because there is no declared structure to check against.
 */
export const genericAdapter: Adapter = {
  name: "generic",
  label: "plain markdown",

  async detect(root) {
    const hits = await fg("**/*.md", { cwd: root, deep: 3, ignore: ["node_modules/**"] });
    return hits.length > 0;
  },

  async load(root) {
    const files = await fg("**/*.md", {
      cwd: root,
      absolute: true,
      ignore: ["node_modules/**", "**/archive/**"],
    });
    return {
      root,
      format: "generic",
      changes: [
        {
          id: path.basename(root),
          root,
          documents: await Promise.all(files.sort().map(loadDocument)),
        },
      ],
    } satisfies SpecProject;
  },
};
