import type { Rule } from "../engine/types.js";
import { clarityRules } from "./clarity.js";
import { structureRules } from "./structure.js";
import { traceabilityRules } from "./traceability.js";
import { scopeRules } from "./scope.js";

export const allRules: Rule[] = [
  ...clarityRules,
  ...structureRules,
  ...traceabilityRules,
  ...scopeRules,
];

export function getRule(id: string): Rule | undefined {
  return allRules.find((r) => r.id === id);
}

export { clarityRules, structureRules, traceabilityRules, scopeRules };
export { WEASEL_WORDS } from "./clarity.js";
