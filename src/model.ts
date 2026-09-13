/**
 * The neutral spec model.
 *
 * Every adapter (OpenSpec, Spec Kit, Kiro, ...) parses its own on-disk layout
 * down to these types. Rules only ever see this model, never raw markdown
 * structure, so a rule written once works across every format.
 */

/** Where a diagnostic points. Lines are 1-indexed to match editors. */
export interface Span {
  /** Absolute path of the file this came from. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** 1-indexed column, when known. */
  column?: number;
  /** The source text of the line, for rendering context. */
  text?: string;
}

/**
 * The role a document plays. Adapters map their own filenames onto these.
 * `spec` is the durable, living specification; everything else is scaffolding
 * that exists only for the duration of a change.
 */
export type DocKind = "proposal" | "design" | "tasks" | "spec" | "constitution" | "unknown";

export interface Section {
  title: string;
  /** Heading depth: 1 for `#`, 2 for `##`, ... */
  level: number;
  /** Body text under this heading, excluding nested subsection bodies. */
  body: string;
  /**
   * 1-indexed line of the first line of `body` in the source file. `body` is
   * trimmed, so this is not simply `span.line + 1`; callers mapping a
   * body-relative offset back to the file must start here.
   */
  bodyStartLine: number;
  span: Span;
  /** Last line covered by this section, inclusive. */
  endLine: number;
}

/** A single acceptance criterion belonging to a requirement. */
export interface Criterion {
  text: string;
  span: Span;
}

/**
 * One normative statement about what the system does. The unit rules care
 * about most: it is the thing that must be unambiguous, testable and traced.
 */
export interface Requirement {
  /** Stable identifier, e.g. `REQ-014`. Undefined when the spec has none. */
  id?: string;
  text: string;
  span: Span;
  /**
   * 1-indexed source line of the first body line. `span.line` is the heading,
   * and blank lines may sit between the two, so the body cannot be located by
   * offsetting from the heading. Absent for requirements parsed from a single
   * prose line, where the whole requirement is `span.line`.
   */
  bodyStartLine?: number;
  criteria: Criterion[];
  /** Title of the nearest enclosing heading, for grouping in reports. */
  sectionTitle?: string;
}

/** A unit of implementation work. */
export interface Task {
  id?: string;
  text: string;
  span: Span;
  done: boolean;
  /** Requirement ids this task claims to implement. */
  refs: string[];
}

export interface SpecDocument {
  path: string;
  kind: DocKind;
  raw: string;
  sections: Section[];
  requirements: Requirement[];
  tasks: Task[];
}

/**
 * A self-contained unit of change. Brownfield formats (OpenSpec) have many;
 * greenfield ones typically produce a single implicit change.
 */
export interface SpecChange {
  id: string;
  /** Directory the change lives in. */
  root: string;
  documents: SpecDocument[];
}

export interface SpecProject {
  root: string;
  /** Which adapter produced this project. */
  format: string;
  changes: SpecChange[];
}

/** Every document across every change, flattened. */
export function allDocuments(project: SpecProject): SpecDocument[] {
  return project.changes.flatMap((c) => c.documents);
}

/** Every requirement across a change, flattened. */
export function changeRequirements(change: SpecChange): Requirement[] {
  return change.documents.flatMap((d) => d.requirements);
}

/** Every task across a change, flattened. */
export function changeTasks(change: SpecChange): Task[] {
  return change.documents.flatMap((d) => d.tasks);
}
