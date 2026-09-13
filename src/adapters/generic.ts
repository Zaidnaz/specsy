import path from "node:path";
import fg from "fast-glob";
import type { Adapter } from "./types.js";
import type { SpecProject } from "../model.js";
import { SCAN_IGNORE, SCAN_OPTS, loadDocument } from "./extract.js";

/**
 * Last-resort adapter: treat a directory of markdown as one change.
 *
 * It exists so someone can point specsy at any spec folder and get value
 * on the first run, without adopting a format first. Traceability rules are
 * weaker here because there is no declared structure to check against.
 */
export const genericAdapter: Adapter = {
  name: "generic",
  label: "plain markdown",
  // Opt-in only. "Any directory containing markdown" describes a home
  // directory as readily as a spec folder.
  autoDetect: false,

  async detect(root) {
    // Only needs to know whether *any* spec-ish file exists, so it stops at
    // the first hit rather than walking an entire home directory.
    const hits = await fg("**/*.md", {
      cwd: root,
      deep: 3,
      ignore: SCAN_IGNORE,
      ...SCAN_OPTS,
    });
    return hits.length > 0;
  },

  async load(root) {
    const files = await fg("**/*.md", {
      cwd: root,
      absolute: true,
      ignore: [...SCAN_IGNORE, "**/archive/**"],
      ...SCAN_OPTS,
    });
    return {
      root,
      format: "generic",
      changes: [
        {
          id: path.basename(root),
          kind: "change",
          root,
          documents: await Promise.all(files.sort().map(loadDocument)),
        },
      ],
    } satisfies SpecProject;
  },
};
