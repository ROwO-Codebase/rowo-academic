import type {
  RequirementDisplayReference,
  RequirementDocument,
  RequirementNode,
  RequirementNodePresentation,
  RequirementReference,
} from "./types";
import { requirementNodePresentation } from "./requirement-node-kinds";

const MAX_REQUIREMENT_TEXT = 4_000;
const MAX_REQUIREMENT_NODES = 2_000;
const MAX_COURSE_CODES = 100;
const MAX_REQUIREMENT_REFERENCES = 500;

export interface PublicRequirementNode {
  nodeId: string | null;
  nodeType: string;
  text: string | null;
  logic: string | null;
  minCount: number | null;
  maxCount: number | null;
  presentation: RequirementNodePresentation;
  references: RequirementDisplayReference[];
  children: PublicRequirementNode[];
}

export interface PublicRequirementSummary {
  id: string;
  kind: string;
  sourceField: string;
  parseStatus: string;
  evaluability: string;
  description: string | null;
  courseCodes: string[];
  root: PublicRequirementNode | null;
  warnings: string[];
}

/** Reduce crawler documents to escaped, bounded, read-only catalog information. */
export function summarizePublicRequirement(
  document: RequirementDocument,
): PublicRequirementSummary {
  const courseCodes = new Set<string>();
  const budget = { nodes: 0, references: 0, text: 0 };
  const root = document.ast.root
    ? summarizeRequirementNode(document.ast.root, courseCodes, budget)
    : null;

  const sourceText = academicHtmlToText(document.sourceHtml ?? "");
  const description = root ? "" : sourceText.slice(0, MAX_REQUIREMENT_TEXT);

  return {
    id: document.documentId,
    kind: document.requirementKind,
    sourceField: document.sourceField,
    parseStatus: document.parseStatus,
    evaluability: document.evaluability,
    description: description || null,
    courseCodes: [...courseCodes].sort(),
    root,
    warnings: document.warnings
      .filter((warning): warning is string => typeof warning === "string")
      .map((warning) => warning.slice(0, 240))
      .slice(0, 5),
  };
}

function summarizeRequirementNode(
  node: RequirementNode,
  courseCodes: Set<string>,
  budget: { nodes: number; references: number; text: number },
): PublicRequirementNode | null {
  if (budget.nodes >= MAX_REQUIREMENT_NODES) return null;
  budget.nodes += 1;

  const references = requirementReferences(node)
    .map((reference) => summarizeReference(reference, courseCodes, budget))
    .filter((reference): reference is RequirementDisplayReference => Boolean(reference));
  const children: PublicRequirementNode[] = [];
  for (const child of node.children ?? []) {
    const summarized = summarizeRequirementNode(child, courseCodes, budget);
    if (summarized) children.push(summarized);
  }

  return {
    nodeId: cleanString(node.node_id, 160),
    nodeType: cleanString(node.node_type, 80) ?? "unknown",
    text: boundedText(node.text, budget),
    logic: cleanString(node.logic ?? node.operator, 40),
    minCount: finiteNumber(node.min_count),
    maxCount: finiteNumber(node.max_count),
    presentation: requirementNodePresentation(node),
    references,
    children,
  };
}

function summarizeReference(
  reference: RequirementReference,
  courseCodes: Set<string>,
  budget: { references: number },
): RequirementDisplayReference | null {
  if (budget.references >= MAX_REQUIREMENT_REFERENCES) return null;
  budget.references += 1;
  const targetType = cleanString(reference.target_type, 40) ?? "unknown";
  const targetCode = cleanString(reference.target_code, 128);
  if (targetType === "course" && targetCode && courseCodes.size < MAX_COURSE_CODES) {
    courseCodes.add(targetCode);
  }
  return {
    ordinal: finiteNumber(reference.ordinal),
    targetType,
    targetPid: cleanString(reference.target_pid, 160),
    targetCode,
    targetTitle: cleanString(reference.target_title, 320),
    credits:
      typeof reference.credits === "number"
        ? reference.credits
        : cleanString(reference.credits ?? reference.displayed_credits, 32),
    resolutionStatus: cleanString(reference.resolution_status, 40),
  };
}

function requirementReferences(node: RequirementNode): RequirementReference[] {
  if (Array.isArray(node.refs)) return node.refs;
  if (Array.isArray(node.references)) return node.references;
  return [];
}

function boundedText(
  value: unknown,
  budget: { text: number },
): string | null {
  const clean = cleanString(value, MAX_REQUIREMENT_TEXT);
  if (!clean || budget.text >= MAX_REQUIREMENT_TEXT) return null;
  const available = MAX_REQUIREMENT_TEXT - budget.text;
  const result = clean.slice(0, available);
  budget.text += result.length;
  return result;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
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
