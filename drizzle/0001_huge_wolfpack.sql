CREATE TABLE `requirement_node_override_references` (
	`id` text PRIMARY KEY NOT NULL,
	`override_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_pid` text NOT NULL,
	`target_version_id` text NOT NULL,
	`target_code` text NOT NULL,
	`target_title` text NOT NULL,
	`credits` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`override_id`) REFERENCES `requirement_node_overrides`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "requirement_node_override_refs_target_type_valid" CHECK("requirement_node_override_references"."target_type" in ('course', 'program')),
	CONSTRAINT "requirement_node_override_refs_target_pid_nonempty" CHECK(length("requirement_node_override_references"."target_pid") > 0),
	CONSTRAINT "requirement_node_override_refs_target_version_id_nonempty" CHECK(length("requirement_node_override_references"."target_version_id") > 0),
	CONSTRAINT "requirement_node_override_refs_target_code_nonempty" CHECK(length("requirement_node_override_references"."target_code") > 0),
	CONSTRAINT "requirement_node_override_refs_target_title_nonempty" CHECK(length("requirement_node_override_references"."target_title") > 0),
	CONSTRAINT "requirement_node_override_refs_credits_nonnegative" CHECK("requirement_node_override_references"."credits" is null or "requirement_node_override_references"."credits" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_node_override_refs_target_uq` ON `requirement_node_override_references` (`override_id`,`target_type`,`target_pid`);--> statement-breakpoint
CREATE INDEX `requirement_node_override_refs_override_idx` ON `requirement_node_override_references` (`override_id`);--> statement-breakpoint
CREATE TABLE `requirement_node_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_program_id` text NOT NULL,
	`catalog_id` text NOT NULL,
	`program_version_id` text NOT NULL,
	`document_id` text NOT NULL,
	`document_source_hash` text NOT NULL,
	`node_key` text NOT NULL,
	`node_id` text,
	`state` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_program_id`) REFERENCES `user_programs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "requirement_node_overrides_catalog_id_nonempty" CHECK(length("requirement_node_overrides"."catalog_id") > 0),
	CONSTRAINT "requirement_node_overrides_program_version_id_nonempty" CHECK(length("requirement_node_overrides"."program_version_id") > 0),
	CONSTRAINT "requirement_node_overrides_document_id_nonempty" CHECK(length("requirement_node_overrides"."document_id") > 0),
	CONSTRAINT "requirement_node_overrides_source_hash_nonempty" CHECK(length("requirement_node_overrides"."document_source_hash") > 0),
	CONSTRAINT "requirement_node_overrides_node_key_nonempty" CHECK(length("requirement_node_overrides"."node_key") > 0),
	CONSTRAINT "requirement_node_overrides_node_id_nonempty" CHECK("requirement_node_overrides"."node_id" is null or length("requirement_node_overrides"."node_id") > 0),
	CONSTRAINT "requirement_node_overrides_state_valid" CHECK("requirement_node_overrides"."state" is null or "requirement_node_overrides"."state" in ('MET', 'NOT_MET', 'UNKNOWN')),
	CONSTRAINT "requirement_node_overrides_note_length" CHECK("requirement_node_overrides"."note" is null or length("requirement_node_overrides"."note") <= 4000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_node_overrides_current_node_uq` ON `requirement_node_overrides` (`user_id`,`user_program_id`,`catalog_id`,`program_version_id`,`document_id`,`document_source_hash`,`node_key`);--> statement-breakpoint
CREATE INDEX `requirement_node_overrides_user_program_idx` ON `requirement_node_overrides` (`user_id`,`user_program_id`);--> statement-breakpoint
CREATE INDEX `requirement_node_overrides_document_idx` ON `requirement_node_overrides` (`user_program_id`,`document_id`);