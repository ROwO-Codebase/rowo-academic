import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type UserDatabaseBindings = {
  USER_DB?: D1Database;
  DB?: D1Database;
};

/** Return the app-owned D1 binding, preferring the explicit `USER_DB` name. */
export function getRawUserDb(): D1Database {
  const bindings = env as unknown as UserDatabaseBindings;
  const binding = bindings.USER_DB ?? bindings.DB;

  if (!binding) {
    throw new Error(
      "The app-owned D1 binding is unavailable. Bind it as `USER_DB` (preferred) or `DB`.",
    );
  }

  return binding;
}

export function getUserDb() {
  return drizzle(getRawUserDb(), { schema });
}

/** Backwards-compatible alias for starter/example imports. */
export const getDb = getUserDb;
