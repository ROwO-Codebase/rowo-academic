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
  RequirementReferenceEvaluation,
  StudentCourseRecord,
  TriState,
} from "./types";
import { requirementNodePresentation } from "./requirement-node-kinds";
import { requirementNodeKey } from "./requirement-overrides";

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
  return evaluateRequirementNodeAtPath(node, context, options, []);
}

function evaluateRequirementNodeAtPath(
  node: RequirementNode,
  context: RequirementEvaluationContext,
  options: RequirementEvaluationOptions,
  path: number[],
): RequirementNodeEvaluation {
  const nodeType = String(node.node_type || "unknown");
  const children = Array.isArray(node.children) ? node.children : [];
  const evaluateChildren = () => children.map((child, index) =>
    evaluateRequirementNodeAtPath(child, context, options, [...path, index]));
  const presentation = requirementNodePresentation(node);
  const unresolvedAggregation = node.params?.aggregation_unresolved === true;
  let evaluation: RequirementNodeEvaluation;

  if (unresolvedAggregation) {
    const childEvaluations = evaluateChildren();
    evaluation = result(
      node,
      UNKNOWN,
      "This aggregate rule retains its structure but its scope is not fully resolved.",
      childEvaluations,
      ["The aggregate requirement scope needs manual review."],
    );
  } else if (nodeType === "group" || presentation === "structural") {
    const childEvaluations = evaluateChildren();
    const state = childEvaluations.length === 0
      ? MET
      : aggregateStates(
          childEvaluations.map((child) => child.state),
          node.logic ?? node.operator ?? "all",
          numberOrNull(node.min_count),
          numberOrNull(node.max_count),
        );
    evaluation = result(node, state, aggregateReason(state), childEvaluations);
  } else if (presentation === "informational") {
    const childEvaluations = evaluateChildren();
    const state = childEvaluations.length === 0
      ? MET
      : aggregateStates(
          childEvaluations.map((child) => child.state),
          node.logic ?? node.operator ?? "all",
          numberOrNull(node.min_count),
          numberOrNull(node.max_count),
        );
    evaluation = result(
      node,
      state,
      childEvaluations.length === 0
        ? "This node provides information and does not add a completion condition."
        : aggregateReason(state),
      childEvaluations,
    );
  } else if (
    nodeType === "course_completed" ||
    nodeType === "course_completed_or_enrolled"
  ) {
    evaluation = combineKnownNodeChildren(
      node,
      evaluatePositiveCourseNode(node, context, options),
      evaluateChildren(),
      courseReferences(node).length > 0,
    );
  } else if (nodeType === "course_pool") {
    evaluation = handlesCoursePoolAggregate(node)
      ? evaluateCoursePoolAggregate(node, context, options, evaluateChildren())
      : combineKnownNodeChildren(
          node,
          evaluatePositiveCourseNode(node, context, options),
          evaluateChildren(),
          courseReferences(node).length > 0,
        );
  } else if (nodeType === "course_forbidden") {
    evaluation = combineKnownNodeChildren(
      node,
      evaluateForbiddenCourseNode(node, context, options),
      evaluateChildren(),
      courseReferences(node).length > 0,
    );
  } else if (nodeType === "program_enrolled") {
    const programEvaluation = evaluateProgramNode(node, context, false);
    evaluation = combineKnownNodeChildren(
      node,
      programEvaluation,
      evaluateChildren(),
      referencesOf(node).some((reference) => reference.target_type === "program") ||
        evaluateHonoursMathematicsProgramRule(node, context) != null,
    );
  } else if (nodeType === "program_forbidden") {
    evaluation = combineKnownNodeChildren(
      node,
      evaluateProgramNode(node, context, true),
      evaluateChildren(),
      referencesOf(node).some((reference) => reference.target_type === "program"),
    );
  } else if (nodeType === "numeric_constraint" || nodeType === "unit_constraint") {
    const numeric = evaluateNumericConstraints(node, context);
    evaluation = combineKnownNodeChildren(
      node,
      result(node, numeric.state, numeric.reason),
      evaluateChildren(),
      numeric.present,
    );
  } else {
    const inferredProgramRule = evaluateOpaqueProgramRule(node, context);
    if (inferredProgramRule) {
      evaluation = combineKnownNodeChildren(
        node,
        inferredProgramRule,
        evaluateChildren(),
        true,
      );
      return applyNodeOverride(evaluation, node, path, options);
    } else {
      const childEvaluations = evaluateChildren();
      evaluation = result(
        node,
        UNKNOWN,
        `The ${nodeType} rule needs manual review.`,
        childEvaluations,
        [`Unsupported or non-machine rule: ${nodeType}`],
      );
    }
  }

  const numericGate = evaluateNumericConstraints(node, context);
  if (
    numericGate.present &&
    !["numeric_constraint", "unit_constraint"].includes(nodeType) &&
    presentation === "condition" &&
    !unresolvedAggregation &&
    !handlesCoursePoolAggregate(node)
  ) {
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

  if (
    isUncertain(node) &&
    evaluation.state === MET
  ) {
    evaluation = {
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

  return applyNodeOverride(evaluation, node, path, options);
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

  const root = evaluateRequirementNodeAtPath(
    document.ast.root,
    context,
    {
      ...options,
      nodeOverrides: options.nodeOverrides?.filter(
        (override) => override.documentId === document.documentId,
      ),
    },
    [],
  );
  const computedState = root.state;
  const declaredIncomplete = document.parseStatus !== "parsed" ||
    document.evaluability === "mixed" || document.evaluability === "unknown";
  const incomplete = document.sourceMatchesCurrentPayload === false ||
    (declaredIncomplete &&
      !hasVerifiedPartialGradeSemantics(document) &&
      !hasOnlyNeutralPartialNodes(document));
  const state = incomplete &&
      computedState === MET &&
      root.manualOverride?.state == null
    ? UNKNOWN
    : computedState;
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
  const referenceEvaluations: RequirementReferenceEvaluation[] = [];
  const gradeMinimum = minimumGrade(node);

  for (const reference of references) {
    const code = referenceCode(reference);
    if (!isResolved(reference)) {
      states.push(UNKNOWN);
      const reason = `Unresolved course reference${code ? ` ${code}` : ""}.`;
      unknownReasons.push(reason);
      referenceEvaluations.push(referenceResult(reference, UNKNOWN, reason));
      continue;
    }
    const courses = matchingCourses(context, reference);
    const courseActivity = pendingCourseActivity(courses);
    const accepted = courses.filter((course) =>
      gradeMinimum != null
        ? course.status === "completed"
        : courseSatisfiesPositiveNode(course, node.node_type, options));
    if (accepted.length === 0) {
      states.push(NOT_MET);
      if (code) unmet.push(code);
      referenceEvaluations.push(referenceResult(
        reference,
        NOT_MET,
        courses.length === 0
          ? `${code || "The course"} is not in the completed course record.`
          : gradeMinimum != null
            ? `${code || "The course"} is recorded but has not been completed.`
            : `${code || "The course"} does not have an accepted completion status.`,
        courseActivity,
      ));
      continue;
    }
    if (gradeMinimum != null) {
      const passing = accepted.find((course) =>
        course.gradePercent != null && course.gradePercent >= gradeMinimum);
      if (passing) {
        states.push(MET);
        if (code) matched.push(code);
        referenceEvaluations.push(referenceResult(
          reference,
          MET,
          `${code || "The course"} was completed with ${formatGrade(passing.gradePercent as number)}, meeting the ${formatGrade(gradeMinimum)} minimum.`,
        ));
      } else if (accepted.some((course) => course.gradePercent == null)) {
        states.push(UNKNOWN);
        const reason = `A grade for ${code || "a referenced course"} is missing.`;
        unknownReasons.push(reason);
        referenceEvaluations.push(referenceResult(reference, UNKNOWN, reason));
      } else {
        states.push(NOT_MET);
        if (code) unmet.push(code);
        const highestGrade = Math.max(...accepted.map((course) => course.gradePercent as number));
        referenceEvaluations.push(referenceResult(
          reference,
          NOT_MET,
          `${code || "The course"} was completed with ${formatGrade(highestGrade)}; ${formatGrade(gradeMinimum)} is required.`,
        ));
      }
    } else {
      states.push(MET);
      if (code) matched.push(code);
      referenceEvaluations.push(referenceResult(
        reference,
        MET,
        `${code || "The course"} has an accepted completion status.`,
      ));
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
    referenceEvaluations,
    matchedCourseCodes: unique(matched),
    unmetCourseCodes: unique(unmet),
  };
}

type CourseSelector = Record<string, unknown>;

function hasCourseSelectorSemantics(node: RequirementNode): boolean {
  return selectorList(node.params?.course_selectors).length > 0 ||
    selectorConstraintList(node.params?.course_selector_constraints).length > 0;
}

function handlesCoursePoolAggregate(node: RequirementNode): boolean {
  if (node.node_type !== "course_pool") return false;
  const logic = String(node.logic ?? node.operator ?? "").toLowerCase();
  return hasCourseSelectorSemantics(node) ||
    node.min_units != null ||
    node.max_units != null ||
    ["at_most", "range"].includes(logic);
}

function evaluateCoursePoolAggregate(
  node: RequirementNode,
  context: RequirementEvaluationContext,
  options: RequirementEvaluationOptions,
  childEvaluations: RequirementNodeEvaluation[],
): RequirementNodeEvaluation {
  const references = courseReferences(node);
  const selectors = selectorList(node.params?.course_selectors);
  const selectorConstraints = selectorConstraintList(
    node.params?.course_selector_constraints,
  );
  const unknownReasons: string[] = [];

  if (node.params?.course_selectors_authoritative === false) {
    return result(
      node,
      UNKNOWN,
      "The course selector is marked ambiguous and needs manual review.",
      childEvaluations,
      ["The crawler retained a non-authoritative course selector."],
    );
  }
  if (
    selectors.some((selector) => !isSupportedCourseSelector(selector)) ||
    selectorConstraints.some((constraint) =>
      selectorList(constraint.course_selectors).some(
        (selector) => !isSupportedCourseSelector(selector),
      ))
  ) {
    return result(
      node,
      UNKNOWN,
      "One or more course selectors are not supported yet.",
      childEvaluations,
      ["The course pool contains an unsupported selector."],
    );
  }
  if (references.length === 0 && selectors.length === 0) {
    return result(
      node,
      UNKNOWN,
      "No course references or selectors were found for this pool.",
      childEvaluations,
      ["Course pool has no selectable course source."],
    );
  }

  const unresolvedReferences = references.some((reference) => !isResolved(reference));
  if (unresolvedReferences) {
    unknownReasons.push("One or more course references could not be resolved.");
  }
  const eligibleCourses = uniqueCourses(
    context.courses.filter((course) => {
      if (!courseSatisfiesPositiveNode(course, "course_pool", options)) return false;
      const referenceMatch = references.some((reference) =>
        isResolved(reference) && matchingCourses(context, reference).includes(course));
      const selectorMatch = selectors.length > 0 &&
        matchesCourseSelectorSet(
          course,
          selectors,
          String(node.params?.course_selector_logic ?? "any"),
        );
      return referenceMatch || selectorMatch;
    }),
  );

  const states: TriState[] = [];
  const logic = String(node.logic ?? node.operator ?? "any").toLowerCase();
  const minCount = numberOrNull(node.min_count) ??
    (node.min_units == null && logic === "at_least" ? 1 : null);
  const maxCount = numberOrNull(node.max_count);
  if (
    minCount != null ||
    maxCount != null ||
    ["any", "all", "none", "at_most", "range"].includes(logic) &&
      node.min_units == null && node.max_units == null
  ) {
    const bounds = countBoundsForPool(logic, minCount, maxCount, references.length);
    states.push(compareBoundedValue(
      eligibleCourses.length,
      bounds.minimum,
      bounds.maximum,
      unresolvedReferences,
    ));
  }

  if (node.min_units != null || node.max_units != null) {
    const knownUnits = eligibleCourses.reduce(
      (sum, course) => sum + (isFiniteNumber(course.credits) ? course.credits : 0),
      0,
    );
    const unitsUncertain = unresolvedReferences ||
      eligibleCourses.some((course) => !isFiniteNumber(course.credits));
    states.push(compareBoundedValue(
      knownUnits,
      numericValue(node.min_units),
      numericValue(node.max_units),
      unitsUncertain,
    ));
  }

  for (const constraint of selectorConstraints) {
    const constraintSelectors = selectorList(constraint.course_selectors);
    const matching = eligibleCourses.filter((course) =>
      matchesCourseSelectorSet(
        course,
        constraintSelectors,
        String(constraint.course_selector_logic ?? "any"),
      ));
    states.push(compareBoundedValue(
      matching.length,
      numericValue(constraint.min_count),
      numericValue(constraint.max_count),
      false,
    ));
  }

  if (states.length === 0) states.push(UNKNOWN);
  const poolState = aggregateStates(states, "all", null, null);
  const state = childEvaluations.length === 0
    ? poolState
    : aggregateStates(
        [poolState, ...childEvaluations.map((child) => child.state)],
        "all",
        null,
        null,
      );
  const evaluation = result(
    node,
    state,
    state === MET
      ? "The recorded courses satisfy this course pool."
      : state === NOT_MET
        ? "The recorded courses do not yet satisfy this course pool."
        : "This course pool cannot be fully determined from the recorded courses.",
    childEvaluations,
    state === UNKNOWN ? unknownReasons : [],
  );
  evaluation.matchedCourseCodes = unique([
    ...evaluation.matchedCourseCodes,
    ...eligibleCourses.map((course) => normalizeCourseCode(course.courseCode)),
  ]);
  evaluation.referenceEvaluations = references.map((reference) => {
    const code = referenceCode(reference);
    if (!isResolved(reference)) {
      return referenceResult(
        reference,
        UNKNOWN,
        `The course reference${code ? ` ${code}` : ""} could not be resolved.`,
      );
    }
    const matched = eligibleCourses.some((course) =>
      matchingCourses(context, reference).includes(course));
    const courseActivity = pendingCourseActivity(
      matchingCourses(context, reference),
    );
    return referenceResult(
      reference,
      matched ? MET : NOT_MET,
      matched
        ? `${code || "The course"} is counted in this course pool.`
        : `${code || "The course"} is not in the accepted course record.`,
      matched ? undefined : courseActivity,
    );
  });
  return evaluation;
}

function selectorList(value: unknown): CourseSelector[] {
  return Array.isArray(value)
    ? value.filter((item): item is CourseSelector =>
        typeof item === "object" && item !== null)
    : [];
}

function selectorConstraintList(value: unknown): CourseSelector[] {
  return selectorList(value);
}

function isSupportedCourseSelector(selector: CourseSelector): boolean {
  return [
    "course_level",
    "course_range",
    "subject_complement",
    "subject_level_wildcard",
    "subject_wildcard",
  ].includes(String(selector.type ?? ""));
}

function matchesCourseSelectorSet(
  course: StudentCourseRecord,
  selectors: CourseSelector[],
  rawLogic: string,
): boolean {
  if (selectors.length === 0) return false;
  const matches = selectors.map((selector) => matchesCourseSelector(course, selector));
  return rawLogic.toLowerCase() === "all"
    ? matches.every(Boolean)
    : matches.some(Boolean);
}

function matchesCourseSelector(
  course: StudentCourseRecord,
  selector: CourseSelector,
): boolean {
  const parsed = parsedCourseCode(course.courseCode);
  if (!parsed) return false;
  const type = String(selector.type ?? "");
  if (type === "subject_wildcard") {
    return stringList(selector.subjects).includes(parsed.subject);
  }
  if (type === "subject_complement") {
    return !stringList(selector.excluded_subjects).includes(parsed.subject);
  }
  if (type === "course_range") {
    const subject = normalizeCourseCode(String(selector.subject ?? ""));
    const minimum = numericValue(selector.minimum);
    const maximum = numericValue(selector.maximum);
    return parsed.subject === subject && minimum != null && maximum != null &&
      parsed.number >= minimum && parsed.number <= maximum;
  }
  if (type === "subject_level_wildcard") {
    if (!stringList(selector.subjects).includes(parsed.subject)) return false;
    return matchesCourseLevel(parsed.level, selector);
  }
  return type === "course_level" && matchesCourseLevel(parsed.level, selector);
}

function matchesCourseLevel(level: number, selector: CourseSelector): boolean {
  const comparison = String(selector.comparison ?? "one_of");
  const levels = numberList(selector.levels);
  const minimum = numericValue(selector.minimum);
  const maximum = numericValue(selector.maximum);
  if (comparison === "at_least") return minimum != null && level >= minimum;
  if (comparison === "at_most") return maximum != null && level <= maximum;
  if (comparison === "range") {
    return minimum != null && maximum != null && level >= minimum && level <= maximum;
  }
  return levels.includes(level);
}

function parsedCourseCode(
  value: string,
): { subject: string; number: number; level: number } | null {
  const match = normalizeCourseCode(value).match(/^([A-Z]+)(\d{3,4})[A-Z]*$/);
  if (!match) return null;
  const number = Number(match[2]);
  return {
    subject: match[1],
    number,
    level: Math.floor(number / 100) * 100,
  };
}

function countBoundsForPool(
  logic: string,
  minCount: number | null,
  maxCount: number | null,
  referenceCount: number,
): { minimum: number | null; maximum: number | null } {
  if (logic === "none") return { minimum: 0, maximum: 0 };
  if (logic === "at_most") return { minimum: 0, maximum: maxCount };
  if (logic === "range") return { minimum: minCount, maximum: maxCount };
  if (logic === "all" && minCount == null && referenceCount > 0) {
    return { minimum: referenceCount, maximum: maxCount };
  }
  return { minimum: minCount ?? 1, maximum: maxCount };
}

function compareBoundedValue(
  actual: number,
  minimum: number | null,
  maximum: number | null,
  uncertainAdditional: boolean,
): TriState {
  if (minimum == null && maximum == null) return UNKNOWN;
  if (maximum != null && actual > maximum) return NOT_MET;
  if (minimum != null && actual < minimum) {
    return uncertainAdditional ? UNKNOWN : NOT_MET;
  }
  if (maximum != null && uncertainAdditional) return UNKNOWN;
  return MET;
}

function uniqueCourses(courses: StudentCourseRecord[]): StudentCourseRecord[] {
  const seen = new Set<string>();
  return courses.filter((course) => {
    const key = course.coursePid ?? normalizeCourseCode(course.courseCode);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => normalizeCourseCode(String(item))).filter(Boolean)
    : [];
}

function numberList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(numericValue).filter((item): item is number => item != null)
    : [];
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
  const referenceEvaluations: RequirementReferenceEvaluation[] = [];
  for (const reference of references) {
    const code = referenceCode(reference);
    if (!isResolved(reference)) {
      violationStates.push(UNKNOWN);
      const reason = `Unresolved forbidden course${code ? ` ${code}` : ""}.`;
      unknownReasons.push(reason);
      referenceEvaluations.push(referenceResult(reference, UNKNOWN, reason));
      continue;
    }
    const violation = matchingCourses(context, reference).some((course) =>
      course.status === "completed" || course.status === "in_progress" ||
      course.status === "enrolled" || (options.includePlanned && course.status === "planned"));
    violationStates.push(violation ? MET : NOT_MET);
    if (violation && code) matched.push(code);
    referenceEvaluations.push(referenceResult(
      reference,
      violation ? NOT_MET : MET,
      violation
        ? `${code || "The course"} is present and violates this exclusion.`
        : `${code || "The course"} is not present.`,
    ));
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
    referenceEvaluations,
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
    const inferred = evaluateHonoursMathematicsProgramRule(node, context);
    if (inferred) return inferred;
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
  const evaluation = result(node, state, forbidden
    ? "Program exclusion check completed."
    : "Program enrolment check completed.");
  evaluation.referenceEvaluations = references.map((reference, index) => {
    const presenceState = presence[index];
    const referenceState = presenceState === UNKNOWN
      ? UNKNOWN
      : forbidden
        ? presenceState === MET ? NOT_MET : MET
        : presenceState;
    const label = String(
      reference.target_code ?? reference.target_title ?? "The program",
    );
    return referenceResult(
      reference,
      referenceState,
      referenceState === UNKNOWN
        ? `${label} could not be resolved.`
        : referenceState === MET
          ? forbidden
            ? `${label} is not among the tracked programs.`
            : `${label} is among the tracked programs.`
          : forbidden
            ? `${label} is among the tracked programs and violates this exclusion.`
            : `${label} is not among the tracked programs.`,
    );
  });
  return evaluation;
}

function evaluateOpaqueProgramRule(
  node: RequirementNode,
  context: RequirementEvaluationContext,
): RequirementNodeEvaluation | null {
  if (node.node_type !== "opaque" || typeof node.text !== "string") return null;
  const honoursMathematics = evaluateHonoursMathematicsProgramRule(node, context);
  if (honoursMathematics) return honoursMathematics;
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

function evaluateHonoursMathematicsProgramRule(
  node: RequirementNode,
  context: RequirementEvaluationContext,
): RequirementNodeEvaluation | null {
  if (
    typeof node.text !== "string" ||
    !isHonoursMathematicsProgramRule(node.text)
  ) {
    return null;
  }

  const eligiblePrograms = (context.programs ?? []).filter((program) =>
    program.status !== "planned" &&
    /^H-/i.test(String(program.programCode ?? "").trim()));
  const found = eligiblePrograms.some((program) =>
    String(program.faculty ?? "").trim().toLowerCase() ===
      "faculty of mathematics");
  const missingFaculty = eligiblePrograms.some((program) => !program.faculty);
  const state = found ? MET : missingFaculty ? UNKNOWN : NOT_MET;
  return result(
    node,
    state,
    found
      ? "A tracked Faculty of Mathematics honours program matches this condition."
      : missingFaculty
        ? "A tracked H- program could not be matched because its faculty is unavailable."
        : "No tracked Faculty of Mathematics program with an H- code matches this condition.",
    [],
    missingFaculty && !found
      ? ["The faculty of a tracked H- program could not be verified."]
      : [],
  );
}

function isHonoursMathematicsProgramRule(text: string): boolean {
  return /^Enrolled in\s+(?:an?\s+)?Honours Mathematics(?:\s+program)?[.:]?$/i
    .test(text.trim());
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
  } else if (logic === "at_most") {
    if (maxCount == null) return UNKNOWN;
    minimum = 0;
    maximum = maxCount;
  } else if (logic === "range") {
    if (minCount == null || maxCount == null) return UNKNOWN;
    minimum = minCount;
    maximum = maxCount;
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

function pendingCourseActivity(
  courses: StudentCourseRecord[],
): "in_progress" | "planned" | undefined {
  if (courses.some((course) => course.status === "in_progress")) {
    return "in_progress";
  }
  if (courses.some((course) => course.status === "planned")) {
    return "planned";
  }
  return undefined;
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

function combineKnownNodeChildren(
  node: RequirementNode,
  evaluation: RequirementNodeEvaluation,
  children: RequirementNodeEvaluation[],
  hasOwnCondition: boolean,
): RequirementNodeEvaluation {
  if (children.length === 0) return evaluation;

  const childState = aggregateStates(
    children.map((child) => child.state),
    node.logic ?? node.operator ?? "all",
    numberOrNull(node.min_count),
    numberOrNull(node.max_count),
  );
  const state = hasOwnCondition
    ? aggregateStates([evaluation.state, childState], "all", null, null)
    : childState;
  const childReason = aggregateReason(childState);

  return {
    ...evaluation,
    state,
    automaticState: state,
    reason: hasOwnCondition
      ? [evaluation.reason, childReason].filter(Boolean).join(" ")
      : childReason,
    matchedCourseCodes: unique([
      ...evaluation.matchedCourseCodes,
      ...children.flatMap((child) => child.matchedCourseCodes),
    ]),
    unmetCourseCodes: unique([
      ...(hasOwnCondition ? evaluation.unmetCourseCodes : []),
      ...children.flatMap((child) => child.unmetCourseCodes),
    ]),
    unknownReasons: unique([
      ...(hasOwnCondition ? evaluation.unknownReasons : []),
      ...children.flatMap((child) => child.unknownReasons),
    ]),
    containsManualOverride: evaluation.containsManualOverride ||
      children.some((child) => child.containsManualOverride),
    containsManualStatusOverride: evaluation.containsManualStatusOverride ||
      children.some((child) => child.containsManualStatusOverride),
    children,
  };
}

function isResolved(reference: RequirementReference): boolean {
  return reference.resolution_status === "resolved" ||
    reference.resolution_status === "code_only";
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
    nodeKey: requirementNodeKey(node),
    nodeType: String(node.node_type || "unknown"),
    text: stringOrNull(node.text),
    logic: stringOrNull(node.logic ?? node.operator),
    minCount: numberOrNull(node.min_count),
    maxCount: numberOrNull(node.max_count),
    references: displayReferences(node),
    presentation: requirementNodePresentation(node),
    state,
    automaticState: state,
    reason,
    referenceEvaluations: [],
    matchedCourseCodes: unique(children.flatMap((child) => child.matchedCourseCodes)),
    unmetCourseCodes: unique(children.flatMap((child) => child.unmetCourseCodes)),
    unknownReasons: unique([
      ...unknownReasons,
      ...children.flatMap((child) => child.unknownReasons),
    ]),
    containsManualOverride: children.some(
      (child) => child.containsManualOverride,
    ),
    containsManualStatusOverride: children.some(
      (child) => child.containsManualStatusOverride,
    ),
    children,
  };
}

function applyNodeOverride(
  evaluation: RequirementNodeEvaluation,
  node: RequirementNode,
  path: number[],
  options: RequirementEvaluationOptions,
): RequirementNodeEvaluation {
  const nodeKey = requirementNodeKey(node, path);
  const manualOverride = options.nodeOverrides?.find(
    (override) => override.nodeKey === nodeKey,
  );
  const automaticState = evaluation.state;
  const state = manualOverride?.state ?? automaticState;
  const manualCourseCodes = manualOverride?.references
    .filter((reference) => reference.targetType === "course")
    .map((reference) => normalizeCourseCode(reference.targetCode)) ?? [];
  const containsManualOverride = Boolean(manualOverride) ||
    evaluation.children.some((child) => child.containsManualOverride);
  const containsManualStatusOverride = manualOverride?.state != null ||
    evaluation.children.some((child) => child.containsManualStatusOverride);

  return {
    ...evaluation,
    nodeKey,
    state,
    automaticState,
    ...(manualOverride ? { manualOverride } : {}),
    containsManualOverride,
    containsManualStatusOverride,
    reason: manualOverride?.state
      ? manualOverride.state === MET
        ? "Manually marked as satisfied."
        : manualOverride.state === NOT_MET
          ? "Manually marked as unsatisfied."
          : "Manually marked as uncertain."
      : evaluation.reason,
    matchedCourseCodes:
      manualOverride?.state === MET
        ? unique([...evaluation.matchedCourseCodes, ...manualCourseCodes])
        : evaluation.matchedCourseCodes,
    unmetCourseCodes:
      manualOverride?.state === MET ? [] : evaluation.unmetCourseCodes,
    unknownReasons:
      manualOverride?.state === MET || manualOverride?.state === NOT_MET
        ? []
        : manualOverride?.state === UNKNOWN
          ? [manualOverride.note || "This node was manually marked as uncertain."]
          : evaluation.unknownReasons,
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

function referenceResult(
  reference: RequirementReference,
  state: TriState,
  reason: string,
  courseActivity?: "in_progress" | "planned",
): RequirementReferenceEvaluation {
  return {
    ordinal: numberOrNull(reference.ordinal),
    targetType: String(reference.target_type ?? "unknown"),
    targetPid: stringOrNull(reference.target_pid),
    targetCode: stringOrNull(reference.target_code),
    ...(courseActivity ? { courseActivity } : {}),
    state,
    reason,
  };
}

function isVerifiedGradeCourseNode(node: RequirementNode): boolean {
  if (!["course_completed", "course_completed_or_enrolled", "course_pool"].includes(
    node.node_type,
  )) return false;
  const gradeMinimum = minimumGrade(node);
  if (gradeMinimum == null || gradeMinimum < 0 || gradeMinimum > 100) return false;
  const references = courseReferences(node);
  if (references.length === 0 || references.some((reference) => !isResolved(reference))) {
    return false;
  }
  const logic = String(
    node.logic ?? node.operator ?? (node.node_type === "course_pool" ? "any" : "all"),
  );
  if (!["all", "any", "at_least"].includes(logic)) return false;
  if (logic === "at_least" && numberOrNull(node.min_count) == null) return false;
  return (node.numeric_constraints ?? []).every(
    (constraint) => constraintKind(constraint) === "grade_percentage",
  );
}

function hasVerifiedPartialGradeSemantics(document: RequirementDocument): boolean {
  if (
    document.parseStatus !== "partial" ||
    document.evaluability !== "mixed" ||
    document.warnings.length > 0 ||
    !document.ast.root
  ) return false;

  let foundVerifiedGradeNode = false;
  let foundUnsupportedPartialNode = false;
  const visit = (node: RequirementNode) => {
    const evaluability = String(node.evaluability ?? "").toLowerCase();
    const parseStatus = String(node.parse_status ?? "").toLowerCase();
    const partial = ["unknown", "manual", "partial", "mixed"].includes(evaluability) ||
      ["unparsed", "partial"].includes(parseStatus);
    if (partial) {
      if (isVerifiedGradeCourseNode(node)) foundVerifiedGradeNode = true;
      else foundUnsupportedPartialNode = true;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.ast.root);
  return foundVerifiedGradeNode && !foundUnsupportedPartialNode;
}

function hasOnlyNeutralPartialNodes(document: RequirementDocument): boolean {
  if (document.sourceFormat === "prose_html" || !document.ast.root) return false;
  let foundPartialNode = false;
  let foundBlockingPartialNode = false;
  const visit = (node: RequirementNode) => {
    const evaluability = String(node.evaluability ?? "").toLowerCase();
    const parseStatus = String(node.parse_status ?? "").toLowerCase();
    const partial = ["unknown", "manual", "partial", "mixed"].includes(evaluability) ||
      ["unparsed", "partial"].includes(parseStatus);
    if (partial) {
      foundPartialNode = true;
      if (requirementNodePresentation(node) === "condition") {
        foundBlockingPartialNode = true;
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.ast.root);
  return foundPartialNode && !foundBlockingPartialNode;
}

function isUncertain(node: RequirementNode): boolean {
  if (requirementNodePresentation(node) !== "condition") return false;
  if (isVerifiedGradeCourseNode(node)) return false;
  const evaluability = String(node.evaluability ?? "").toLowerCase();
  const parseStatus = String(node.parse_status ?? "").toLowerCase();
  return ["unknown", "manual", "partial", "mixed"].includes(evaluability) ||
    ["unparsed", "partial"].includes(parseStatus) ||
    node.node_type === "opaque" || node.node_type === "scope_constraint";
}

function formatGrade(value: number): string {
  return (Number.isInteger(value) ? String(value) : value.toFixed(1)) + "%";
}

function collectNodeCodes(node: RequirementNodeEvaluation, output: string[]): void {
  if (node.state === MET) return;
  output.push(...node.unmetCourseCodes);
  for (const child of node.children) collectNodeCodes(child, output);
}

function collectUnknownReasons(
  node: RequirementNodeEvaluation,
  output: string[],
): void {
  if (node.state !== UNKNOWN) return;
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
