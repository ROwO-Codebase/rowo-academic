import { env } from "cloudflare:workers";
import {
  AcademicDataError,
  getCatalogMetadata,
  searchPrograms,
} from "@/lib/academic";
import { getLocalSession } from "@/lib/auth";
import type { AcademicEnvironment, ProgramSearchOptions } from "@/lib/types";

const MAX_QUERY_LENGTH = 120;
const MAX_FILTER_LENGTH = 120;
const MAX_PAGE_SIZE = 50;
const MAX_OFFSET = 10_000;
const QUERY_KEYS = new Set([
  "q",
  "faculty",
  "credentialType",
  "career",
  "limit",
  "offset",
]);

class InputError extends Error {}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function cleanText(
  value: string | null,
  label: string,
  maximumLength: number,
): string | undefined {
  if (value == null) return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return undefined;
  if (cleaned.length > maximumLength || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new InputError(`${label} is invalid or too long.`);
  }
  return cleaned;
}

function boundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new InputError(`${label} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InputError(`${label} is outside the supported range.`);
  }
  return parsed;
}

function validateQuery(searchParams: URLSearchParams) {
  const seen = new Set<string>();
  for (const key of searchParams.keys()) {
    if (!QUERY_KEYS.has(key)) {
      throw new InputError(`Unsupported query parameter: ${key}.`);
    }
    if (seen.has(key)) {
      throw new InputError(`Query parameter ${key} may only be supplied once.`);
    }
    seen.add(key);
  }
}

export async function GET(request: Request) {
  try {
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }

    const url = new URL(request.url);
    validateQuery(url.searchParams);
    const options: ProgramSearchOptions = {
      query: cleanText(url.searchParams.get("q"), "q", MAX_QUERY_LENGTH),
      faculty: cleanText(
        url.searchParams.get("faculty"),
        "faculty",
        MAX_FILTER_LENGTH,
      ),
      credentialType: cleanText(
        url.searchParams.get("credentialType"),
        "credentialType",
        MAX_FILTER_LENGTH,
      ),
      career: cleanText(
        url.searchParams.get("career"),
        "career",
        MAX_FILTER_LENGTH,
      ),
      limit: boundedInteger(
        url.searchParams.get("limit"),
        25,
        1,
        MAX_PAGE_SIZE,
        "limit",
      ),
      offset: boundedInteger(
        url.searchParams.get("offset"),
        0,
        0,
        MAX_OFFSET,
        "offset",
      ),
    };

    // The academic repository uses prepared parameters and escapes LIKE
    // metacharacters; this route additionally caps every user-controlled value.
    const academicEnv = env as unknown as AcademicEnvironment;
    const [programs, catalog] = await Promise.all([
      searchPrograms(academicEnv, options),
      getCatalogMetadata(academicEnv),
    ]);

    return Response.json(
      {
        success: true,
        catalog,
        programs,
        pagination: {
          limit: options.limit,
          offset: options.offset,
          returned: programs.length,
          hasMore: programs.length === options.limit,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_QUERY", error.message, 400);
    }
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Unable to search programs.", 500);
  }
}
