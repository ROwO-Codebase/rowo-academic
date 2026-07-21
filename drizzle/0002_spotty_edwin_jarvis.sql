CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`include_grades` integer DEFAULT false NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "share_links_token_hash_shape" CHECK(length("share_links"."token_hash") = 64 and "share_links"."token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "share_links_kind_valid" CHECK("share_links"."kind" in ('schedule', 'progress')),
	CONSTRAINT "share_links_grades_schedule_only" CHECK("share_links"."include_grades" = 0 or "share_links"."kind" = 'schedule'),
	CONSTRAINT "share_links_payload_size" CHECK(length("share_links"."payload") between 2 and 262144),
	CONSTRAINT "share_links_expiry_after_creation" CHECK("share_links"."expires_at" is null or "share_links"."expires_at" > "share_links"."created_at"),
	CONSTRAINT "share_links_revocation_after_creation" CHECK("share_links"."revoked_at" is null or "share_links"."revoked_at" >= "share_links"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_uq` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `share_links_user_created_idx` ON `share_links` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `share_links_expires_at_idx` ON `share_links` (`expires_at`);