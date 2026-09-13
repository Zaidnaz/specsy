/**
 * Shared markdown→model extraction, used by every markdown-based adapter.
 * Kept separate so a new adapter only has to describe its directory layout.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Criterion, DocKind, Requirement, SpecDocument, Task } from "../model.js";
import { parseListItems, parseSections, readLines } from "../markdown.js";

/** `REQ-014`, `AUTH-3`. Two-to-five uppercase alphanumerics, a dash, digits. */
export const EXPLICIT_ID = /\b([A-Z][A-Z0-9]{1,4}-\d+)\b/;
/** Leading decimal numbering, e.g. `1.2 ` or `3. ` at the start of an item. */
export const NUMERIC_ID = /^(\d+(?:\.\d+)*)[.)]?\s+/;
const REQ_HEADING = /^Requirement:\s*(.+)$/i;
const SCENARIO_HEADING = /^Scenario:\s*(.+)$/i;
/** RFC 2119 normative keywords, used by the lenient fallback. */
export const NORMATIVE = /\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|MAY)\b/;

export function kindFor(file: string): DocKind {
  const base = path.basename(file).toLowerCase();
  if (base === "proposal.md") return "proposal";
  if (base === "design.md" || base === "plan.md") return "design";
  if (base === "tasks.md") return "tasks";
  if (base === "spec.md" || base === "specs.md" || base === "requirements.md") return "spec";
  if (base === "project.md" || base === "constitution.md") return "constitution";
  return "unknown";
}

export function extractId(text: string): string | undefined {
  return EXPLICIT_ID.exec(text)?.[1];
}

/**
 * Requirements come from `### Requirement: <name>` headings when the document
 * follows OpenSpec strictly. Documents that don't — hand-written proposals,
 * mostly — fall back to any prose line carrying an RFC 2119 keyword, so the
 * linter still has something to say instead of silently passing.
 */
export function extractRequirements(raw: string, file: string, kind: DocKind): Requirement[] {
  const sections = parseSections(raw, file);
  const out: Requirement[] = [];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!;
    const m = REQ_HEADING.exec(sec.title);
    if (!m) continue;

    const name = (m[1] ?? "").trim();
    const criteria: Criterion[] = [];
    // Scenario subsections nested under this requirement are its criteria.
    for (let j = i + 1; j < sections.length; j++) {
      const next = sections[j]!;
      if (next.level <= sec.level) break;
      const sm = SCENARIO_HEADING.exec(next.title);
      if (sm) criteria.push({ text: `${(sm[1] ?? "").trim()} ${next.body}`.trim(), span: next.span });
    }
    // Bullet criteria written directly under the requirement heading.
    for (const item of parseListItems(sec.body, file)) {
      criteria.push({ text: item.text, span: { ...sec.span, line: sec.bodyStartLine + item.span.line - 1 } });
    }

    const id = extractId(name) ?? extractId(sec.body);
    out.push({
      ...(id ? { id } : {}),
      text: `${name}\n${sec.body}`.trim(),
      span: sec.span,
      criteria,
      sectionTitle: name,
    });
  }

  if (out.length > 0 || kind === "tasks" || kind === "design") return out;

  // Lenient fallback: normative prose lines become requirements.
  let heading: string | undefined;
  for (const line of readLines(raw)) {
    if (line.inCode) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line.text);
    if (h) {
      heading = (h[1] ?? "").trim();
      continue;
    }
    const text = line.text.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\[[ xX]\]\s*/, "").trim();
    if (!text || !NORMATIVE.test(text)) continue;
    const id = extractId(text);
    out.push({
      ...(id ? { id } : {}),
      text,
      span: { file, line: line.number, text: line.text },
      criteria: [],
      ...(heading ? { sectionTitle: heading } : {}),
    });
  }
  return out;
}

/** Checkbox list items are tasks; plain bullets are not. */
export function extractTasks(raw: string, file: string): Task[] {
  const out: Task[] = [];
  const global = new RegExp(EXPLICIT_ID, "g");
  for (const item of parseListItems(raw, file)) {
    if (item.checked === undefined) continue;
    const numeric = NUMERIC_ID.exec(item.text)?.[1];
    const refs = [...item.text.matchAll(global)].map((m) => m[1]!);
    // An id-shaped token is the task's own id only when it opens the item
    // (`TASK-3: do the thing`). Anywhere else it is a reference to a
    // requirement, which is the whole point of the traceability rules.
    const leading = EXPLICIT_ID.exec(item.text);
    const ownId = leading?.index === 0 ? leading[1] : undefined;
    if (ownId) refs.shift();
    const id = numeric ?? ownId;
    out.push({
      ...(id ? { id } : {}),
      text: item.text.replace(NUMERIC_ID, "").trim(),
      span: item.span,
      done: item.checked,
      refs,
    });
  }
  return out;
}

export async function loadDocument(file: string): Promise<SpecDocument> {
  const raw = await readFile(file, "utf8");
  const kind = kindFor(file);
  return {
    path: file,
    kind,
    raw,
    sections: parseSections(raw, file),
    requirements: extractRequirements(raw, file, kind),
    tasks: kind === "tasks" || kind === "unknown" ? extractTasks(raw, file) : [],
  };
}
