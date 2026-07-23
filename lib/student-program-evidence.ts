import { getProgramsByPids } from "./academic";
import type {
  AcademicEnvironment,
  AcademicProgram,
  StudentProgramRecord,
} from "./types";

export interface SavedProgramEvidenceSource {
  catalogId: string;
  programPid: string;
  programCode: string;
  programName: string;
  programType: string | null;
}

export interface HydratedStudentProgram<
  T extends SavedProgramEvidenceSource = SavedProgramEvidenceSource,
> {
  saved: T;
  catalog: AcademicProgram | null;
  evidence: StudentProgramRecord | null;
}

export async function hydrateStudentPrograms<
  T extends SavedProgramEvidenceSource,
>(
  academicEnv: AcademicEnvironment,
  programs: T[],
  activeCatalogId: string,
): Promise<Array<HydratedStudentProgram<T>>> {
  const activePrograms = programs.filter(
    (saved) => saved.catalogId === activeCatalogId,
  );
  const catalogPrograms = await getProgramsByPids(
    academicEnv,
    activePrograms.map((saved) => saved.programPid),
  );
  const catalogProgramsByPid = new Map(
    catalogPrograms.map((program) => [program.pid, program]),
  );

  return programs.map((saved) => {
    if (saved.catalogId !== activeCatalogId) {
      return { saved, catalog: null, evidence: null };
    }

    const catalog = catalogProgramsByPid.get(saved.programPid) ?? null;
    return {
      saved,
      catalog,
      evidence: {
        programPid: saved.programPid,
        programCode: saved.programCode,
        programTitle: saved.programName,
        programType: saved.programType,
        faculty: catalog?.faculty ?? null,
        status: "active",
      },
    };
  });
}

export function studentProgramEvidence<T extends SavedProgramEvidenceSource>(
  programs: Array<HydratedStudentProgram<T>>,
): StudentProgramRecord[] {
  return programs.flatMap((program) =>
    program.evidence ? [program.evidence] : []);
}
