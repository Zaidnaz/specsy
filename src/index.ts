/** Programmatic API. The CLI is a thin wrapper over exactly these exports. */
export * from "./model.js";
export * from "./engine/types.js";
export { lint, resolveConfig, type LintResult } from "./engine/lint.js";
export { loadConfig } from "./engine/config.js";
export { allRules, getRule, WEASEL_WORDS } from "./rules/index.js";
export { adapters, getAdapter, detectAdapter, type Adapter } from "./adapters/index.js";
export { formatPretty } from "./report/pretty.js";
export { formatJson } from "./report/json.js";
export { formatGithub } from "./report/github.js";
