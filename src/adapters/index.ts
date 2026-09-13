import type { Adapter } from "./types.js";
import { openspecAdapter } from "./openspec.js";
import { genericAdapter } from "./generic.js";

/** Ordered by specificity: the first match wins during auto-detection. */
export const adapters: Adapter[] = [openspecAdapter, genericAdapter];

export function getAdapter(name: string): Adapter | undefined {
  return adapters.find((a) => a.name === name);
}

export async function detectAdapter(root: string): Promise<Adapter | undefined> {
  for (const adapter of adapters) {
    if (await adapter.detect(root)) return adapter;
  }
  return undefined;
}

export type { Adapter };
