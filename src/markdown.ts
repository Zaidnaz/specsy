/**
 * A deliberately small markdown reader.
 *
 * We only need headings, list items and fenced-code awareness, and we need
 * exact line numbers for every one of them. A full CommonMark parser would
 * bring a dependency tree and an AST we would immediately flatten back into
 * lines, so this stays hand-rolled and zero-dep.
 */
import type { Section, Span } from "./model.js";

export interface Line {
  /** 1-indexed. */
  number: number;
  text: string;
  /** True when the line sits inside a fenced code block. Rules skip these. */
  inCode: boolean;
}

const FENCE = /^\s{0,3}(```+|~~~+)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const CHECKBOX = /^\[([ xX~-])\]\s*(.*)$/;

/** Split into lines, tracking which ones are inside fenced code blocks. */
export function readLines(raw: string): Line[] {
  const out: Line[] = [];
  let fence: string | null = null;
  const src = raw.split(/\r?\n/);
  for (let i = 0; i < src.length; i++) {
    const text = src[i] ?? "";
    const m = FENCE.exec(text);
    if (m) {
      const marker = m[1]!;
      if (fence === null) {
        fence = marker[0]!; // ` or ~
        out.push({ number: i + 1, text, inCode: true });
        continue;
      }
      if (marker[0] === fence) {
        fence = null;
        out.push({ number: i + 1, text, inCode: true });
        continue;
      }
    }
    out.push({ number: i + 1, text, inCode: fence !== null });
  }
  return out;
}

/** Lines that carry prose — outside code fences and not blank. */
export function proseLines(lines: Line[]): Line[] {
  return lines.filter((l) => !l.inCode && l.text.trim() !== "");
}

/**
 * Build the section tree, flattened. `body` holds only the text directly under
 * a heading, stopping at the next heading of any level, so a rule that checks
 * "is this section empty" is not fooled by a populated subsection.
 */
export function parseSections(raw: string, file: string): Section[] {
  const lines = readLines(raw);
  const sections: Section[] = [];
  let current: { section: Section; body: string[] } | null = null;

  const close = (endLine: number) => {
    if (!current) return;
    const raw = current.body;
    const lead = raw.findIndex((l) => l.trim() !== "");
    current.section.body = current.body.join("\n").trim();
    // Skip past the heading line, plus any blank lines the trim removed.
    current.section.bodyStartLine = current.section.span.line + 1 + (lead === -1 ? 0 : lead);
    current.section.endLine = endLine;
    sections.push(current.section);
    current = null;
  };

  for (const line of lines) {
    const m = line.inCode ? null : HEADING.exec(line.text);
    if (m) {
      close(line.number - 1);
      current = {
        section: {
          title: (m[2] ?? "").trim(),
          level: (m[1] ?? "#").length,
          body: "",
          bodyStartLine: line.number + 1,
          span: { file, line: line.number, text: line.text },
          endLine: line.number,
        },
        body: [],
      };
      continue;
    }
    if (current) current.body.push(line.text);
  }
  close(lines.length);
  return sections;
}

export interface ListItem {
  /** Indentation width in spaces. */
  indent: number;
  /** Item text, with any leading `[ ]` checkbox already removed. */
  text: string;
  span: Span;
  /** Present only when the item was a checkbox. */
  checked?: boolean;
}

/** Collect bullet and ordered list items, outside code fences. */
export function parseListItems(raw: string, file: string): ListItem[] {
  const out: ListItem[] = [];
  for (const line of readLines(raw)) {
    if (line.inCode) continue;
    const m = BULLET.exec(line.text) ?? ORDERED.exec(line.text);
    if (!m) continue;
    let text = (m[2] ?? "").trim();
    let checked: boolean | undefined;
    const box = CHECKBOX.exec(text);
    if (box) {
      checked = (box[1] ?? " ").toLowerCase() === "x";
      text = (box[2] ?? "").trim();
    }
    out.push({
      indent: (m[1] ?? "").length,
      text,
      span: { file, line: line.number, text: line.text },
      ...(checked === undefined ? {} : { checked }),
    });
  }
  return out;
}

/** Remove inline code spans and link URLs so word rules don't match identifiers. */
export function stripNoise(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>\s]+>/g, " ");
}

/** Find a section whose title matches any of the given patterns. */
export function findSection(sections: Section[], patterns: RegExp[]): Section | undefined {
  return sections.find((s) => patterns.some((p) => p.test(s.title)));
}
