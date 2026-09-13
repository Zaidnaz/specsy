import type { SpecProject } from "../model.js";

export interface Adapter {
  /** Stable name used in config and `--format`. */
  name: string;
  /** Human-readable name of the format this reads. */
  label: string;
  /**
   * Cheap structural test: does this directory look like our format?
   * Must not read file contents beyond what is needed to decide.
   */
  detect(root: string): Promise<boolean>;
  /** Parse the directory into the neutral model. */
  load(root: string): Promise<SpecProject>;
}
