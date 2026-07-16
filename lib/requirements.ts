import type {
  CourseEligibilityResult,
  CourseRecommendation,
  RequirementDisplayReference,
  RequirementDocument,
  RequirementDocumentEvaluation,
  RequirementEvaluationContext,
  RequirementEvaluationOptions,
  RequirementEvaluationSummary,
  RequirementNode,
  RequirementNodeEvaluation,
  RequirementNumericConstraint,
  RequirementReference,
  StudentCourseRecord,
  TriState,
} from "./types";

const MET: TriState = "MET";
const NOT_MET: TriState = "NOT_MET";
const UNKNOWN: TriState = "UNKNOWN";

export function normalizeCourseCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function evaluateRequirementNode(
  node: RequirementNode,
  context: RequirementEvaluationContext,
  options: RequirementEvaluationOptions = {},
): RequirementNodeEvaluation {
  const nodeType = String(node.node_type || "unknown");
  const children = Array.isArray(node.children) ? node.children : [];
  let evaluation: RequirementNodeEvaluation;

  if (["root", "group", "section", "heading"].includes(nodeType)) {
    const childEvaluations = children.map((child) =>
      evaluateRequirementNode(child, context, options));
    const state = aggregateStates(
      childEvaluations.map((child) => child.state),
      node.logic ?? node.operator ?? "all",
      numberOrNull(node.min_count),
      numberOrNull(node.max_count),
    );
    evaluation = result(node, state, aggregateReason(state), childEvaluations);
  } else if (
    nodeType === "course_completed" ||
    nodeType === "course_completed_or_enrolled" ||
    nodeType === "course_pool"
  ) {
    evaluation = evaluatePositiveCourseNode(node, context, options);
  } else if (nodeType === "course_forbidden") {
    evaluation = evaluateForbiddenCourseNode(node, context, options);
  } else if (nodeType === "program_enrolled") {
    evaluation = evaluateProgramNode(node, context, false);
  } else if (nodeType === "program_forbidden") {
    evaluation = evaluateProgramNode(node, context, true);
  } else if (nodeType === "numeric_constraint") {
    const numeric = evaluateNumericConstraints(node, context);
    evaluation = result(node, numeric.state, numeric.reason);
  } else {
    const inferredProgramRule = evaluateOpaqueProgramRule(node, context);
    if (inferredProgramRule) return inferredProgramRule;
    const childEvaluations = children.map((child) =>
      evaluateRequirementNode(child, context, options));
    evaluation = result(
      node,
      UNKNOWN,
      `The ${nodeType} rule needs manual review.`,
      childEvaluations,
      [`Unsupported or non-machine rule: ${nodeType}`],
    );
  }

  const numericGate = evaluateNumericConstraints(node, context);
  if (numericGate.present && nodeType !== "numeric_constraint") {
    const combined = aggregateStates(
      [evaluation.state, numericGate.state],
      "all",
      null,
      null,
    );
    evaluation = {
      ...evaluation,
      state: combined,
      reason: combined === evaluation.state
        ? evaluation.reason
        : `${evaluation.reason} ${numericGate.reason}`,
      unknownReasons:
        numericGate.state === UNKNOWN
          ? unique([...evaluation.unknownReasons, numericGate.reason])
          : evaluation.unknownReasons,
    };
  }

  if (isUncertain(node) && evaluation.state === MET) {
    return {
      ...evaluation,
      state: UNKNOWN,
      provisionalState: evaluation.state,
      reason: `${evaluation.reason} This rule is marked partial or manual.`,
      unknownReasons: unique([
        ...evaluation.unknownReasons,
        "The source parser marked this rule as partial or non-machine.",
      ]),
    };
  }

  return evaluation;
}

export function evaluateRequirementDocument(
  document: RequirementDocument,
  context: RequirementEvaluationContext,
  options: RequirementEvaluationOptions = {},
): RequirementDocumentEvaluation {
  if (!document.ast?.root) {
    return {
      documentId: document.documentId,
      ownerType: document.ownerType,
      ownerPid: document.ownerPid,
      requirementKind: document.requirementKind,
      sourceField: document.sourceField,
      parseStatus: document.parseStatus,
      state: UNKNOWN,
      computedState: UNKNOWN,
      reason: "No machine-readable requirement tree is available.",
      root: null,
      warnings: unique([...document.warnings, "missing_requirement_root"]),
    };
  }

  const root = evaluateRequirementNode(document.ast.root, context, options);
  const computedState = root.state;
  const incomplete = document.parseStatus !== "parsed" ||
    document.evaluability === "mixed" || document.evaluability === "unknown" ||
    document.sourceMatchesCurrentPayload === false;
  const state = incomplete && computedState === MET ? UNKNOWN : computedState;
  return {
    documentId: document.documentId,
    ownerType: document.ownerType,
    ownerPid: document.ownerPid,
    requirementKind: document.requirementKind,
    sourceField: document.sourceField,
    parseStatus: document.parseStatus,
    state,
    computedState,
    reason:
      state !== computedState
        ? document.sourceMatchesCurrentPayload === false
          ? "The serialized rule no longer matches the current catalog payload and needs review."
          : "Known checks pass, but the source document is only partially machine-readable."
        : root.reason,
    root,
    warnings: document.warnings,
  };
}

export function evaluateRequirementDocuments(
  documents: RequirementDocument[],
  context: RequirementEvaluationContext,
  options: RequirementEvaluationOptions = {},
): RequirementEvaluationSummary {
  const evaluations = documents.map((document) =>
    evaluateRequirementDocument(document, context, options));
  const states = evaluations.map((evaluation) => evaluation.state);
  return {
    state: states.length === 0
      ? UNKNOWN
      : aggregateStates(states, "all", null, null),
    documents: evaluations,
    metCount: states.filter((state) => state === MET).length,
    notMetCount: states.filter((state) => state === NOT_MET).length,
    unknownCount: states.filter((state) => state === UNKNOWN).length,
  };
}

export function collectUnmetCourseCodes(
  analysis: RequirementEvaluationSummary | RequirementDocumentEvaluation,
): string[] {
  const documents = "documents" in analysis ? analysis.documents : [analysis];
  const codes: string[] = [];
  for (const document of documents) {
    if (document.root) collectNodeCodes(document.root, codes);
  }
  return unique(codes.map(normalizeCourseCode).filter(Boolean)).sort();
}

export function extractCourseRecommendations(
  documents: RequirementDocument[],
  context: RequirementEvaluationContext,
): CourseRecommendation[] {
  const recommendations = new Map<string, CourseRecommendation>();
  for (const document of documents) {
    const root = document.ast?.root;
    if (!root) continue;
    const evaluation = evaluateRequirementDocument(document, context);
    if (!evaluation.root || evaluation.state === MET) continue;
    walkBlockingNodes(root, evaluation.root, (node) => {
      if (![
        "course_completed",
        "course_completed_or_enrolled",
        "course_pool",
      ].includes(node.node_type)) return;
      const references = courseReferences(node);
      const isOption = node.node_type === "course_pool" ||
        ["any", "at_least"].includes(String(node.logic ?? node.operator ?? "all"));
      for (const reference of references) {
        if (!isResolved(reference)) continue;
        const code = normalizeCourseCode(String(reference.target_code ?? ""));
        if (!code || hasAnyCourse(context, reference)) continue;
        const key = String(reference.target_pid ?? code);
        if (!recommendations.has(key)) {
          recommendations.set(key, {
            coursePid: stringOrNull(reference.target_pid),
            courseCode: code,
            title: stringOrNull(reference.target_title),
            relation: String(reference.relation ?? "required"),
            requirementKind: document.requirementKind,
            documentId: document.documentId,
            sourceField: document.sourceField,
            isOption,
            reason: isOption
              ? `${code} is one available option for an unmet requirement.`
              : `${code} is referenced by an unmet ${document.requirementKind} rule.`,
          });
        }
      }
    });
  }
  return [...recommendations.values()].sort((left, right) =>
    Number(left.isOption) - Number(right.isOption) ||
    left.courseCode.localeCompare(right.courseCode));
}

export function validateCourseEligibility(
  documents: RequirementDocument[],
  context: RequirementEvaluationContext,
  options: RequirementEvaluationOptions = {},
): CourseEligibilityResult {
  const relevant = documents.filter((document) => [
    "prerequisite",
    "corequisite",
    "antirequisite",
  ].includes(document.requirementKind));
  const evaluations = relevant.map((document) =>
    evaluateRequirementDocument(document, context, options));
  const states = evaluations.map((evaluation) => evaluation.state);
  const state = states.length === 0 ? MET : aggregateStates(states, "all", null, null);
  const summary: RequirementEvaluationSummary = {
    state,
    documents: evaluations,
    metCount: states.filter((item) => item === MET).length,
    notMetCount: states.filter((item) => item === NOT_MET).length,
    unknownCount: states.filter((item) => item === UNKNOWN).length,
  };
  const unknownReasons: string[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.root) collectUnknownReasons(evaluation.root, unknownReasons);
    if (evaluation.state === UNKNOWN) unknownReasons.push(evaluation.reason);
  }
  return {
    state,
    eligible: state === MET,
    needsReview: state === UNKNOWN,
    documents: evaluations,
    unmetCourseCodes: collectUnmetCourseCodes(summary),
    unknownReasons: unique(unknownReasons),
  };
}

function evaluatePositiveCourseNode(
  node: RequirementNode,
  context: RequirementEvaluationContext,
  options: RequirementEvaluationOptions,
): RequirementNodeEvaluation {
  const references = courseReferences(node);
  if (references.length === 0) {
    return result(node, UNKNOWN, "No resolvable course references were found.", [], [
      "Course rule has no references.",
    ]);
  }
  const states: TriState[] = [];
  const matched: string[] = [];
  const unmet: string[] = [];
  const unknownReasons: string[] = [];
  const gradeMinimum = minimumGrade(node);

  for (const reference of references) {
    const code = referenceCode(reference);
    if (!isResolved(reference)) {
      states.push(UNKNOWN);
      unknownReasons.push(`Unresolved course reference${code ? ` ${code}` : ""}.`);
      continue;
    }
    const courses = matchingCourses(context, reference);
    const accepted = courses.filter((course) =>
      courseSatisfiesPositiveNode(course, node.node_type, options));
    if (accepted.length === 0) {
      states.push(NOT_MET);
      if (code) unmet.push(code);
      continue;
    }
    if (gradeMinimum != null) {
      if (accepted.some((course) =>
        course.gradePercent != null && course.gradePercent >= gradeMinimum)) {
        states.push(MET);
        if (code) matched.push(code);
      } else if (accepted.some((course) => course.gradePercent == null)) {
        states.push(UNKNOWN);
        unknownReasons.push(`A grade for ${code || "a referenced course"} is missing.`);
      } else {
        states.push(NOT_MET);
        if (code) unmet.push(code);
      }
    } else {
      states.push(MET);
      if (code) matched.push(code);
    }
  }

  const defaultLogic = node.node_type === "course_pool" ? "any" : "all";
  const state = aggregateStates(
    states,
    node.logic ?? node.operator ?? defaultLogic,
    numberOrNull(node.min_count),
    numberOrNull(node.max_count),
  );
  return {
    ...result(node, state, courseStateReason(state), [], unknownReasons),
    matchedCourseCodes: unique(matched),
    unmetCourseCodes: unique(unmet),
  };
}

function evaluateForbiddenCourseNode(
  node: RequirementNode,
  context: RequirementEvaluationContext,
  options: RequirementEvaluationOptions,
): RequirementNodeEvaluation {
  const references = courseReferences(node);
  if (references.length === 0) {
    return result(node, UNKNOWN, "No antirequisite course references were found.", [], [
      "Forbidden-course rule has no references.",
    ]);
  }
  const violationStates: TriState[] = [];
  const matched: string[] = [];
  const unknownReasons: string[] = [];
  for (const reference of references) {
    const code = referenceCode(reference);
    if (!isResolved(reference)) {
      violationStates.push(UNKNOWN);
      unknownReasons.push(`Unresolved forbidden course${code ? ` ${code}` : ""}.`);
      continue;
    }
    const violation = matchingCourses(context, reference).some((course) =>
      course.status === "completed" || course.status === "in_progress" ||
      course.status === "enrolled" || (options.includePlanned && course.status === "planned"));
    violationStates.push(violation ? MET : NOT_MET);
    if (violation && code) matched.push(code);
  }
  const state = aggregateStates(violationStates, "none", 0, 0);
  return {
    ...result(
      node,
      state,
      state === NOT_MET
        ? "A completed or enrolled course conflicts with this antirequisite."
        : state === MET
          ? "No listed antirequisite was found."
          : "Some antirequisite references could not be verified.",
      [],
      unknownReasons,
    ),
    matchedCourseCodes: unique(matched),
  };
}

function evaluateProgramNode(
  node: RequirementNode,
  context: RequirementEvaluationContext,
  forbidden: boolean,
): RequirementNodeEvaluation {
  const references = referencesOf(node).filter((reference) =>
    reference.target_type === "program");
  if (references.length === 0) {
    return result(node, UNKNOWN, "No program references were found.", [], [
      "Program rule has no references.",
    ]);
  }
  const presence: TriState[] = references.map((reference) => {
    if (!isResolved(reference)) return UNKNOWN;
    const found = (context.programs ?? []).some((program) => {
      if (reference.target_pid) return program.programPid === reference.target_pid;
      return normalizeCourseCode(String(program.programCode ?? "")) ===
        normalizeCourseCode(String(reference.target_code ?? ""));
    });
    return found ? MET : NOT_MET;
  });
  const state = forbidden
    ? aggregateStates(presence, "none", 0, 0)
    : aggregateStates(
        presence,
        node.logic ?? node.operator ?? "any",
        numberOrNull(node.min_count),
        numberOrNull(node.max_count),
      );
  return result(node, state, forbidden
    ? "Program exclusion check completed."
    : "Program enrolment check completed.");
}

function evaluateOpaqueProgramRule(
  node: RequirementNode,
  context: RequirementEvaluationContext,
): RequirementNodeEvaluation | null {
  if (node.node_type !== "opaque" || typeof node.text !== "string") return null;
  const match = node.text.trim().match(
    /^Enrolled in\s+(?:an?\s+)?(.+?)\s+program[.:]?$/i,
  );
  if (!match) return null;

  const requiredWords = normalizedWords(match[1]).filter(
    (word) => !["a", "an", "the", "program"].includes(word),
  );
  if (requiredWords.length === 0) return null;
  const found = (context.programs ?? []).some((program) => {
    if (program.status === "planned") return false;
    const searchable = normalizedWords([
      program.programCode,
      program.programTitle,
      program.programType,
    ].filter(Boolean).join(" "));
    return requiredWords.every((word) => searchable.includes(word));
  });
  return result(
    node,
    found ? MET : NOT_MET,
    found
      ? `A tracked program matches “${match[1].trim()}”.`
      : `No tracked program matches “${match[1].trim()}”.`,
  );
}

function evaluateNumericConstraints(
  node: RequirementNode,
  context: RequirementEvaluationContext,
): { present: boolean; state: TriState; reason: string } {
  const constraints = Array.isArray(node.numeric_constraints)
    ? node.numeric_constraints
    : [];
  const unitConstraints = constraints.filter((constraint) =>
    constraintKind(constraint) === "academic_units");
  const gradeHandledByCourseNode = [
    "course_completed",
    "course_completed_or_enrolled",
    "course_pool",
  ].includes(node.node_type);
  const unsupportedConstraints = constraints.filter((constraint) => {
    const kind = constraintKind(constraint);
    return kind !== "academic_units" &&
      !(kind === "grade_percentage" && gradeHandledByCourseNode);
  });
  if (unsupportedConstraints.length > 0) {
    return {
      present: true,
      state: UNKNOWN,
      reason: "One or more numeric constraints need manual review.",
    };
  }
  if (unitConstraints.length === 0 && node.min_units == null && node.max_units == null) {
    return { present: false, state: MET, reason: "" };
  }
  const units = availableUnits(context);
  if (units == null) {
    return {
      present: true,
      state: UNKNOWN,
      reason: "Completed-unit information is insufficient for this rule.",
    };
  }

  const states: TriState[] = [];
  if (unitConstraints.length > 0) {
    for (const constraint of unitConstraints) {
      states.push(compareNumericConstraint(units, constraint));
    }
  } else {
    if (node.min_units != null) states.push(units >= Number(node.min_units) ? MET : NOT_MET);
    if (node.max_units != null) states.push(units <= Number(node.max_units) ? MET : NOT_MET);
  }
  const state = aggregateStates(states, "all", null, null);
  return {
    present: true,
    state,
    reason: state === MET
      ? "The completed-unit constraint is met."
      : state === NOT_MET
        ? "The completed-unit constraint is not met."
        : "The completed-unit constraint needs review.",
  };
}

function compareNumericConstraint(
  actual: number,
  constraint: RequirementNumericConstraint,
): TriState {
  const comparison = String(constraint.comparison ?? constraint.qualifier ?? "stated");
  const value = numericValue(constraint.value_num ?? constraint.numeric_value);
  const maximum = numericValue(
    constraint.value_num_max ?? constraint.numeric_value_max,
  );
  if (value == null) return UNKNOWN;
  if (comparison === "minimum" || comparison === "at_least") {
    return actual >= value ? MET : NOT_MET;
  }
  if (comparison === "maximum") return actual <= value ? MET : NOT_MET;
  if (comparison === "range") {
    return maximum == null ? UNKNOWN : actual >= value && actual <= maximum ? MET : NOT_MET;
  }
  if (comparison === "total") return actual >= value ? MET : NOT_MET;
  return UNKNOWN;
}

function aggregateStates(
  states: TriState[],
  rawLogic: string | null,
  minCount: number | null,
  maxCount: number | null,
): TriState {
  if (states.length === 0) return UNKNOWN;
  const logic = (rawLogic ?? "").toLowerCase();
  let minimum: number;
  let maximum: number;
  if (logic === "all") {
    minimum = states.length;
    maximum = states.length;
  } else if (logic === "any") {
    minimum = minCount ?? 1;
    maximum = maxCount ?? states.length;
  } else if (logic === "at_least") {
    if (minCount == null) return UNKNOWN;
    minimum = minCount;
    maximum = maxCount ?? states.length;
  } else if (logic === "none") {
    minimum = 0;
    maximum = 0;
  } else {
    return UNKNOWN;
  }
  if (maxCount != null) maximum = Math.min(maximum, maxCount);
  const met = states.filter((state) => state === MET).length;
  const unknown = states.filter((state) => state === UNKNOWN).length;
  const possible = met + unknown;
  if (met > maximum || possible < minimum) return NOT_MET;
  if (met >= minimum && possible <= maximum) return MET;
  return UNKNOWN;
}

function courseSatisfiesPositiveNode(
  course: StudentCourseRecord,
  nodeType: string,
  options: RequirementEvaluationOptions,
): boolean {
  if (course.status === "completed") return true;
  if (nodeType === "course_completed_or_enrolled") {
    if (course.status === "in_progress" || course.status === "enrolled") return true;
  }
  return options.includePlanned === true && course.status === "planned";
}

function minimumGrade(node: RequirementNode): number | null {
  const direct = numericValue(node.min_grade_percent ?? node.min_grade);
  if (direct != null) return direct;
  for (const constraint of node.numeric_constraints ?? []) {
    if (constraintKind(constraint) === "grade_percentage") {
      return numericValue(constraint.value_num ?? constraint.numeric_value);
    }
  }
  return null;
}

function availableUnits(context: RequirementEvaluationContext): number | null {
  if (isFiniteNumber(context.completedUnits)) return context.completedUnits;
  if (isFiniteNumber(context.totalUnits)) return context.totalUnits;
  const completed = context.courses.filter((course) => course.status === "completed");
  if (completed.length === 0 || completed.some((course) => !isFiniteNumber(course.credits))) {
    return null;
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const course of completed) {
    const key = course.coursePid ?? normalizeCourseCode(course.courseCode);
    if (seen.has(key)) continue;
    seen.add(key);
    sum += course.credits as number;
  }
  return sum;
}

function matchingCourses(
  context: RequirementEvaluationContext,
  reference: RequirementReference,
): StudentCourseRecord[] {
  if (reference.target_pid) {
    const pidMatches = context.courses.filter(
      (course) => course.coursePid === reference.target_pid,
    );
    if (pidMatches.length > 0) return pidMatches;
    const code = referenceCode(reference);
    return context.courses.filter(
      (course) => !course.coursePid && normalizeCourseCode(course.courseCode) === code,
    );
  }
  const code = referenceCode(reference);
  return context.courses.filter((course) =>
    normalizeCourseCode(course.courseCode) === code);
}

function hasAnyCourse(
  context: RequirementEvaluationContext,
  reference: RequirementReference,
): boolean {
  return matchingCourses(context, reference).length > 0;
}

function courseReferences(node: RequirementNode): RequirementReference[] {
  const seen = new Set<string>();
  return referencesOf(node).filter((reference) => {
    if (reference.target_type !== "course") return false;
    const key = String(
      reference.target_pid ?? reference.target_version_id ?? referenceCode(reference),
    );
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function referencesOf(node: RequirementNode): RequirementReference[] {
  if (Array.isArray(node.refs)) return node.refs;
  if (Array.isArray(node.references)) return node.references;
  return [];
}

function isResolved(reference: RequirementReference): boolean {
  return reference.resolution_status === "resolved";
}

function referenceCode(reference: RequirementReference): string {
  return normalizeCourseCode(String(reference.target_code ?? ""));
}

function result(
  node: RequirementNode,
  state: TriState,
  reason: string,
  children: RequirementNodeEvaluation[] = [],
  unknownReasons: string[] = [],
): RequirementNodeEvaluation {
  return {
    nodeId: stringOrNull(node.node_id),
    nodeType: String(node.node_type || "unknown"),
    text: stringOrNull(node.text),
    logic: stringOrNull(node.logic ?? node.operator),
    minCount: numberOrNull(node.min_count),
    maxCount: numberOrNull(node.max_count),
    references: displayReferences(node),
    state,
    reason,
    matchedCourseCodes: unique(children.flatMap((child) => child.matchedCourseCodes)),
    unmetCourseCodes: unique(children.flatMap((child) => child.unmetCourseCodes)),
    unknownReasons: unique([
      ...unknownReasons,
      ...children.flatMap((child) => child.unknownReasons),
    ]),
    children,
  };
}

function displayReferences(node: RequirementNode): RequirementDisplayReference[] {
  return referencesOf(node).map((reference) => ({
    ordinal: numberOrNull(reference.ordinal),
    targetType: String(reference.target_type ?? "unknown"),
    targetPid: stringOrNull(reference.target_pid),
    targetCode: stringOrNull(reference.target_code),
    targetTitle: stringOrNull(reference.target_title),
    credits:
      typeof reference.credits === "number"
        ? reference.credits
        : stringOrNull(reference.credits ?? reference.displayed_credits),
    resolutionStatus: stringOrNull(reference.resolution_status),
  }));
}

function isUncertain(node: RequirementNode): boolean {
  const evaluability = String(node.evaluability ?? "").toLowerCase();
  const parseStatus = String(node.parse_status ?? "").toLowerCase();
  return ["unknown", "manual", "partial", "mixed"].includes(evaluability) ||
    ["unparsed", "partial"].includes(parseStatus) ||
    node.node_type === "opaque" || node.node_type === "scope_constraint";
}

function collectNodeCodes(node: RequirementNodeEvaluation, output: string[]): void {
  output.push(...node.unmetCourseCodes);
  for (const child of node.children) collectNodeCodes(child, output);
}

function collectUnknownReasons(
  node: RequirementNodeEvaluation,
  output: string[],
): void {
  output.push(...node.unknownReasons);
  for (const child of node.children) collectUnknownReasons(child, output);
}

function walkBlockingNodes(
  node: RequirementNode,
  evaluation: RequirementNodeEvaluation,
  visitor: (node: RequirementNode) => void,
): void {
  if (evaluation.state === MET) return;
  visitor(node);
  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const childEvaluation = evaluation.children[index];
    if (childEvaluation) {
      walkBlockingNodes(children[index], childEvaluation, visitor);
    }
  }
}

function aggregateReason(state: TriState): string {
  if (state === MET) return "All required child rules are met.";
  if (state === NOT_MET) return "One or more required child rules are not met.";
  return "One or more child rules cannot be determined automatically.";
}

function courseStateReason(state: TriState): string {
  if (state === MET) return "The referenced course requirement is met.";
  if (state === NOT_MET) return "The referenced course requirement is not met.";
  return "The referenced course requirement cannot be fully determined.";
}

function constraintKind(constraint: RequirementNumericConstraint): string {
  return String(constraint.constraint_kind ?? constraint.metric ?? "");
}

function numberOrNull(value: unknown): number | null {
  const result = Number(value);
  return value == null || !Number.isFinite(result) ? null : result;
}

function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function numericValue(value: unknown): number | null {
  return numberOrNull(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export type {
  CourseEligibilityResult,
  CourseRecommendation,
  RequirementDocument,
  RequirementDocumentEvaluation,
  RequirementEvaluationContext,
  RequirementEvaluationOptions,
  RequirementEvaluationSummary,
  RequirementNode,
  RequirementNodeEvaluation,
  TriState,
} from "./types";
