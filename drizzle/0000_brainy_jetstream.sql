CREATE TABLE `course_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`catalog_id` text NOT NULL,
	`course_pid` text NOT NULL,
	`course_version_id` text NOT NULL,
	`course_code` text NOT NULL,
	`course_title` text NOT NULL,
	`status` text NOT NULL,
	`term` text,
	`grade` text,
	`credits` real,
	`calendar_year` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "course_records_catalog_id_nonempty" CHECK(length("course_records"."catalog_id") > 0),
	CONSTRAINT "course_records_pid_nonempty" CHECK(length("course_records"."course_pid") > 0),
	CONSTRAINT "course_records_version_id_nonempty" CHECK(length("course_records"."course_version_id") > 0),
	CONSTRAINT "course_records_code_nonempty" CHECK(length("course_records"."course_code") > 0),
	CONSTRAINT "course_records_status_valid" CHECK("course_records"."status" in ('completed', 'in_progress', 'planned', 'transfer')),
	CONSTRAINT "course_records_credits_nonnegative" CHECK("course_records"."credits" is null or "course_records"."credits" >= 0),
	CONSTRAINT "course_records_grade_matches_status" CHECK("course_records"."grade" is null or "course_records"."status" in ('completed', 'transfer')),
	CONSTRAINT "course_records_active_term_required" CHECK("course_records"."status" not in ('planned', 'in_progress') or ("course_records"."term" is not null and length(trim("course_records"."term")) > 0)),
	CONSTRAINT "course_records_calendar_year_valid" CHECK("course_records"."calendar_year" between 2000 and 9999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_records_user_course_term_uq` ON `course_records` (`user_id`,`course_code`,`term`);--> statement-breakpoint
CREATE UNIQUE INDEX `course_records_user_course_unscheduled_uq` ON `course_records` (`user_id`,`course_code`) WHERE "course_records"."term" is null;--> statement-breakpoint
CREATE INDEX `course_records_user_status_idx` ON `course_records` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `course_records_catalog_id_idx` ON `course_records` (`catalog_id`);--> statement-breakpoint
CREATE INDEX `course_records_user_course_idx` ON `course_records` (`user_id`,`course_code`);--> statement-breakpoint
CREATE INDEX `course_records_user_term_idx` ON `course_records` (`user_id`,`term`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_token_hash_shape" CHECK(length("sessions"."token_hash") = 64 and "sessions"."token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "sessions_expiry_after_creation" CHECK("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`catalog_id` text NOT NULL,
	`program_pid` text NOT NULL,
	`program_version_id` text NOT NULL,
	`program_code` text NOT NULL,
	`program_name` text NOT NULL,
	`calendar_year` integer NOT NULL,
	`program_type` text DEFAULT 'program' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_programs_catalog_id_nonempty" CHECK(length("user_programs"."catalog_id") > 0),
	CONSTRAINT "user_programs_pid_nonempty" CHECK(length("user_programs"."program_pid") > 0),
	CONSTRAINT "user_programs_version_id_nonempty" CHECK(length("user_programs"."program_version_id") > 0),
	CONSTRAINT "user_programs_code_nonempty" CHECK(length("user_programs"."program_code") > 0),
	CONSTRAINT "user_programs_name_nonempty" CHECK(length("user_programs"."program_name") > 0),
	CONSTRAINT "user_programs_type_nonempty" CHECK(length("user_programs"."program_type") > 0),
	CONSTRAINT "user_programs_calendar_year_valid" CHECK("user_programs"."calendar_year" between 2000 and 9999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_programs_user_code_year_uq` ON `user_programs` (`user_id`,`program_code`,`calendar_year`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_programs_one_primary_uq` ON `user_programs` (`user_id`) WHERE "user_programs"."is_primary" = 1;--> statement-breakpoint
CREATE INDEX `user_programs_user_id_idx` ON `user_programs` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_programs_catalog_id_idx` ON `user_programs` (`catalog_id`);--> statement-breakpoint
CREATE INDEX `user_programs_calendar_year_idx` ON `user_programs` (`calendar_year`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`rowo_user_id` text NOT NULL,
	`username` text NOT NULL,
	`wechat_id` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_rowo_user_id_nonempty" CHECK(length("users"."rowo_user_id") > 0),
	CONSTRAINT "users_username_nonempty" CHECK(length("users"."username") > 0),
	CONSTRAINT "users_role_valid" CHECK("users"."role" in ('user', 'moderator', 'admin', 'super_admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_rowo_user_id_uq` ON `users` (`rowo_user_id`);--> statement-breakpoint
CREATE INDEX `users_username_idx` ON `users` (`username`);