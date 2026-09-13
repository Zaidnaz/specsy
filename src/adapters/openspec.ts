import { stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { Adapter } from "./types.js";
import type { SpecChange, SpecProject } from "../model.js";
import { SCAN_OPTS, loadDocument } from "./extract.js";

/**
 * OpenSpec layout:
 *
 *   openspec/
 *     project.md
 *     specs/<capability>/spec.md            living source of truth
 *     changes/<change-id>/proposal.md
 *                        /design.md
 *                        /tasks.md
 *                        /specs/<cap>/spec.md   delta
 *     changes/archive/...                   already folded in, skipped
 */

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Locate the `openspec/` directory, whether root points at it or above it. */
async function specRoot(root: string): Promise<string | null> {
  if (await isDir(path.join(root, "changes"))) return root;
  if (await isDir(path.join(root, "openspec", "changes"))) return path.join(root, "openspec");
  return null;
}

export const openspecAdapter: Adapter = {
  name: "openspec",
  label: "OpenSpec",
  autoDetect: true,
  hasChanges: true,

  async detect(root) {
    return (await specRoot(root)) !== null;
  },

  async load(root) {
    const base = (await specRoot(root)) ?? root;
    const changes: SpecChange[] = [];

    const changeDirs = await fg("*", {
      cwd: path.join(base, "changes"),
      onlyDirectories: true,
      absolute: true,
      ...SCAN_OPTS,
    });

    for (const dir of changeDirs.sort()) {
      if (path.basename(dir) === "archive") continue; // already folded into specs/
      const files = await fg("**/*.md", { cwd: dir, absolute: true, ...SCAN_OPTS });
      if (files.length === 0) continue;
      changes.push({
        id: path.basename(dir),
        kind: "change",
        root: dir,
        documents: await Promise.all(files.sort().map(loadDocument)),
      });
    }

    // The living spec is its own pseudo-change so rules can inspect it too.
    const specFiles = await fg("specs/**/*.md", { cwd: base, absolute: true, ...SCAN_OPTS });
    if (specFiles.length > 0) {
      changes.push({
        id: "(living spec)",
        kind: "living",
        root: path.join(base, "specs"),
        documents: await Promise.all(specFiles.sort().map(loadDocument)),
      });
    }

    return { root: base, format: "openspec", changes } satisfies SpecProject;
  },
};
