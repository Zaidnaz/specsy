import type { SpecChange, SpecDocument, SpecProject, Span } from "../model.js";

export type Severity = "error" | "warn" | "off";

export interface Diagnostic {
  /** Rule that produced this, e.g. `no-weasel-words`. */
  rule: string;
  severity: Exclude<Severity, "off">;
  message: string;
  span: Span;
  /** Short, concrete suggestion. Rendered under the message. */
  hint?: string;
}

export interface RuleContext {
  project: SpecProject;
  change: SpecChange;
  /** Resolved configuration, with defaults already merged in. */
  config: Config;
  /** Report a finding. Severity is filled in from config by the engine. */
  report(d: Omit<Diagnostic, "severity" | "rule">): void;
}

/**
 * A rule runs once per document. Rules that need cross-document knowledge
 * (traceability, for instance) read it off `ctx.change`, which holds every
 * document in the same unit of change.
 */
export interface Rule {
  id: string;
  /** One line, shown in `specsy rules`. */
  description: string;
  /** Severity when the user has not configured one. */
  defaultSeverity: Exclude<Severity, "off">;
  /** Document kinds this rule applies to. Omit to run on all of them. */
  appliesTo?: SpecDocument["kind"][];
  check(doc: SpecDocument, ctx: RuleContext): void;
}

export interface Config {
  /** Adapter to use. `auto` detects from the directory layout. */
  format?: string;
  /** Per-rule severity overrides. `off` disables. */
  rules?: Record<string, Severity>;
  /** Extra weasel words to flag, merged with the built-in list. */
  weaselWords?: string[];
  /** Glob patterns to skip. */
  ignore?: string[];
}

export const defaultConfig: Config = {
  format: "auto",
  rules: {},
  weaselWords: [],
  ignore: [],
};
