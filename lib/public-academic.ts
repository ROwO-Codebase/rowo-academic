import type { RequirementDocument, RequirementNode } from "./types";

const MAX_REQUIREMENT_TEXT = 4_000;
const MAX_REQUIREMENT_NODES = 2_000;
const MAX_COURSE_CODES = 100;

export interface PublicRequirementSummary {
  id: string;
  kind: string;
  sourceField: string;
  parseStatus: string;
  evaluability: string;
  description: string | null;
  courseCodes: string[];
  warnings: string[];
}

/** Reduce crawler documents to escaped, bounded, read-only catalog information. */
export function summarizePublicRequirement(
  document: RequirementDocument,
): PublicRequirementSummary {
  const courseCodes = new Set<string>();
  const nodeText: string[] = [];
  const stack: RequirementNode[] = document.ast.root ? [document.ast.root] : [];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_REQUIREMENT_NODES) {
    const node = stack.pop();
    if (!node) continue;
    visited += 1;

    if (typeof node.text === "string" && node.text.trim()) {
      nodeText.push(node.text.trim());
    }
    for (const constraint of node.numeric_constraints ?? []) {
      if (typeof constraint.raw_text === "string" && constraint.raw_text.trim()) {
        nodeText.push(constraint.raw_text.trim());
      }
    }
    for (const reference of [...(node.refs ?? []), ...(node.references ?? [])]) {
      if (courseCodes.size >= MAX_COURSE_CODES) break;
      const code =
        typeof reference.target_code === "string"
          ? reference.target_code.trim().replace(/\s+/g, " ")
          : "";
      if (code && code.length <= 32) courseCodes.add(code);
    }
    for (const child of node.children ?? []) stack.push(child);
  }

  const sourceText = academicHtmlToText(document.sourceHtml ?? "");
  const fallbackText = nodeText.join(" ").replace(/\s+/g, " ").trim();
  const description = (sourceText || fallbackText).slice(0, MAX_REQUIREMENT_TEXT);

  return {
    id: document.documentId,
    kind: document.requirementKind,
    sourceField: document.sourceField,
    parseStatus: document.parseStatus,
    evaluability: document.evaluability,
    description: description || null,
    courseCodes: [...courseCodes].sort(),
    warnings: document.warnings
      .filter((warning): warning is string => typeof warning === "string")
      .map((warning) => warning.slice(0, 240))
      .slice(0, 5),
  };
}

function academicHtmlToText(html: string): string {
  if (!html) return "";
  return decodeAcademicEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<\/li\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeAcademicEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, key: string) => {
      const normalized = key.toLowerCase();
      if (normalized in named) return named[normalized];
      const radix = normalized.startsWith("#x") ? 16 : 10;
      const raw = normalized.replace(/^#x?/, "");
      const codePoint = Number.parseInt(raw, radix);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}
