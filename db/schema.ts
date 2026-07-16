import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const COURSE_RECORD_STATUSES = [
  "completed",
  "in_progress",
  "planned",
  "transfer",
] as const;

export type CourseRecordStatus = (typeof COURSE_RECORD_STATUSES)[number];

/**
 * Local application users. `rowo_user_id` is the stable identity returned by
 * ROwO; the upstream ROwO session token is deliberately never persisted.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    rowoUserId: text("rowo_user_id").notNull(),
    username: text("username").notNull(),
    wechatId: text("wechat_id"),
    role: text("role", {
      enum: ["user", "moderator", "admin", "super_admin"],
    })
      .notNull()
      .default("user"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("users_rowo_user_id_uq").on(table.rowoUserId),
    index("users_username_idx").on(table.username),
    check("users_rowo_user_id_nonempty", sql`length(${table.rowoUserId}) > 0`),
    check("users_username_nonempty", sql`length(${table.username}) > 0`),
    check(
      "users_role_valid",
      sql`${table.role} in ('user', 'moderator', 'admin', 'super_admin')`,
    ),
  ],
);

/**
 * App-local sessions. The cookie contains a random secret; only its SHA-256
 * digest is stored here, so a database read does not reveal usable sessions.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
    check(
      "sessions_token_hash_shape",
      sql`length(${table.tokenHash}) = 64 and ${table.tokenHash} not glob '*[^0-9a-f]*'`,
    ),
    check("sessions_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const userPrograms = sqliteTable(
  "user_programs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    catalogId: text("catalog_id").notNull(),
    programPid: text("program_pid").notNull(),
    programVersionId: text("program_version_id").notNull(),
    programCode: text("program_code").notNull(),
    programName: text("program_name").notNull(),
    calendarYear: integer("calendar_year").notNull(),
    programType: text("program_type").notNull().default("program"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("user_programs_user_code_year_uq").on(
      table.userId,
      table.programCode,
      table.calendarYear,
    ),
    uniqueIndex("user_programs_one_primary_uq")
      .on(table.userId)
      .where(sql`${table.isPrimary} = 1`),
    index("user_programs_user_id_idx").on(table.userId),
    index("user_programs_catalog_id_idx").on(table.catalogId),
    index("user_programs_calendar_year_idx").on(table.calendarYear),
    check("user_programs_catalog_id_nonempty", sql`length(${table.catalogId}) > 0`),
    check("user_programs_pid_nonempty", sql`length(${table.programPid}) > 0`),
    check(
      "user_programs_version_id_nonempty",
      sql`length(${table.programVersionId}) > 0`,
    ),
    check("user_programs_code_nonempty", sql`length(${table.programCode}) > 0`),
    check("user_programs_name_nonempty", sql`length(${table.programName}) > 0`),
    check("user_programs_type_nonempty", sql`length(${table.programType}) > 0`),
    check(
      "user_programs_calendar_year_valid",
      sql`${table.calendarYear} between 2000 and 9999`,
    ),
  ],
);

/**
 * User-owned course attempts and plans. Course facts are copied as snapshots
 * instead of foreign-keying into the independently versioned calendar D1.
 */
export const courseRecords = sqliteTable(
  "course_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    catalogId: text("catalog_id").notNull(),
    coursePid: text("course_pid").notNull(),
    courseVersionId: text("course_version_id").notNull(),
    courseCode: text("course_code").notNull(),
    courseTitle: text("course_title").notNull(),
    status: text("status", { enum: COURSE_RECORD_STATUSES }).notNull(),
    term: text("term"),
    grade: text("grade"),
    credits: real("credits"),
    calendarYear: integer("calendar_year").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("course_records_user_course_term_uq").on(
      table.userId,
      table.courseCode,
      table.term,
    ),
    uniqueIndex("course_records_user_course_unscheduled_uq")
      .on(table.userId, table.courseCode)
      .where(sql`${table.term} is null`),
    index("course_records_user_status_idx").on(table.userId, table.status),
    index("course_records_catalog_id_idx").on(table.catalogId),
    index("course_records_user_course_idx").on(table.userId, table.courseCode),
    index("course_records_user_term_idx").on(table.userId, table.term),
    check("course_records_catalog_id_nonempty", sql`length(${table.catalogId}) > 0`),
    check("course_records_pid_nonempty", sql`length(${table.coursePid}) > 0`),
    check(
      "course_records_version_id_nonempty",
      sql`length(${table.courseVersionId}) > 0`,
    ),
    check("course_records_code_nonempty", sql`length(${table.courseCode}) > 0`),
    check(
      "course_records_status_valid",
      sql`${table.status} in ('completed', 'in_progress', 'planned', 'transfer')`,
    ),
    check(
      "course_records_credits_nonnegative",
      sql`${table.credits} is null or ${table.credits} >= 0`,
    ),
    check(
      "course_records_grade_matches_status",
      sql`${table.grade} is null or ${table.status} in ('completed', 'transfer')`,
    ),
    check(
      "course_records_active_term_required",
      sql`${table.status} not in ('planned', 'in_progress') or (${table.term} is not null and length(trim(${table.term})) > 0)`,
    ),
    check(
      "course_records_calendar_year_valid",
      sql`${table.calendarYear} between 2000 and 9999`,
    ),
  ],
);
